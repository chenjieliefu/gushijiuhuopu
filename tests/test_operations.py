from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.ai import MockAI
from app.errors import AppError
from app.limits import Limits
from app.main import create_app
from app.models import AIOutput, Story
from app.store import Store
from scripts.backup import backup_database

STORY = Story.model_validate_json(Path('stories/demo.json').read_text())


def test_rate_limit_cannot_be_bypassed_by_forwarded_header(tmp_path, monkeypatch):
    monkeypatch.setenv('CORS_ORIGINS','http://localhost:5178')
    app = create_app(tmp_path/'db.sqlite3', limits=Limits(sessions_per_hour=1))
    with TestClient(app) as client:
        assert client.post('/api/sessions').status_code == 201
        response = client.post('/api/sessions', headers={
            'X-Forwarded-For':'203.0.113.99','Origin':'http://localhost:5178',
        })
        assert response.status_code == 429
        assert response.json()['error']['code'] == 'RATE_LIMITED'
        assert int(response.headers['retry-after']) > 0
        assert response.headers['access-control-allow-origin'] == 'http://localhost:5178'
        assert response.headers['x-request-id'] == response.json()['error']['trace_id']


@pytest.mark.parametrize('headers',[{}, {'Content-Length':'1'}])
def test_body_limit_checks_received_bytes_not_only_content_length(tmp_path, headers):
    with TestClient(create_app(tmp_path/'db.sqlite3',limits=Limits(max_request_bytes=16))) as client:
        response = client.post('/api/sessions',content=iter([b'x'*10,b'y'*10]),headers=headers)
        assert response.status_code == 413
        assert response.json()['error']['code'] == 'REQUEST_TOO_LARGE'
        assert response.headers['cache-control'] == 'no-store'


def test_daily_call_budget_is_atomic_and_survives_restart(tmp_path):
    now = [1700000000.0]
    limits = Limits(ai_daily_calls=2)
    store = Store(tmp_path/'db.sqlite3',limits,clock=lambda:now[0])
    store.initialize()
    def reserve(_):
        try:
            store.reserve_ai_call()
            return 'ok'
        except AppError as exc:
            return exc.code
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(reserve,range(4)))
    assert results.count('ok') == 2 and results.count('AI_DAILY_LIMIT') == 2
    restarted = Store(store.path,limits,clock=lambda:now[0])
    restarted.initialize()
    with pytest.raises(AppError,match='今日'):
        restarted.reserve_ai_call()
    now[0] += 86400
    restarted.reserve_ai_call()


def test_success_replay_does_not_spend_daily_budget_again(tmp_path):
    app = create_app(tmp_path/'db.sqlite3',limits=Limits(ai_daily_calls=1))
    with TestClient(app) as client:
        created = client.post('/api/sessions').json()
        headers = {'Authorization':f"Bearer {created['token']}"}
        body = {'request_id':str(uuid4()),'expected_version':0,'message':'你好'}
        first = client.post('/api/chat',headers=headers,json=body)
        assert first.status_code == 200
        assert client.post('/api/chat',headers=headers,json=body).json() == first.json()
        second = client.post('/api/chat',headers=headers,json=body | {'request_id':str(uuid4()),'expected_version':1})
        assert second.json()['error']['code'] == 'AI_DAILY_LIMIT'
        assert client.get('/api/session',headers=headers).json() == first.json()


def test_provider_failure_still_counts_as_a_potentially_paid_attempt(tmp_path):
    class Broken:
        async def generate(self,**kwargs):
            raise RuntimeError('upstream')
    app = create_app(tmp_path/'db.sqlite3',ai=Broken(),limits=Limits(ai_daily_calls=1))
    with TestClient(app) as client:
        created = client.post('/api/sessions').json()
        headers = {'Authorization':f"Bearer {created['token']}"}
        body = {'request_id':str(uuid4()),'expected_version':0,'message':'你好'}
        assert client.post('/api/chat',headers=headers,json=body).status_code == 502
        app.state.game.ai = MockAI()
        response = client.post('/api/chat',headers=headers,json=body)
        assert response.json()['error']['code'] == 'AI_DAILY_LIMIT'
        assert client.get('/api/session',headers=headers).json()['version'] == 0


def test_expiry_preview_cleanup_and_activity_survive_restart(tmp_path):
    now = [1000.0]
    limits = Limits(session_ttl_seconds=30)
    store = Store(tmp_path/'db.sqlite3',limits,clock=lambda:now[0])
    store.initialize()
    token,state = store.create(STORY)
    store.commit(state,0,str(uuid4()),'fixture-fingerprint')
    now[0] += 20
    store.get(token)  # read activity renews the retention window
    now[0] += 20
    restarted = Store(store.path,limits,clock=lambda:now[0])
    restarted.initialize()
    assert restarted.get(token).version == 1
    now[0] += 31
    with pytest.raises(AppError,match='过期'):
        restarted.get(token)
    assert restarted.cleanup() == {'expired_sessions':1,'dry_run':True}
    with restarted.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] == 1
    assert restarted.cleanup(dry_run=False)['expired_sessions'] == 1
    with restarted.connection() as db:
        for table in ['sessions','requests','session_activity']:
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0


def test_legacy_database_gets_one_retention_period_from_upgrade(tmp_path):
    now = [1000.0]
    store = Store(tmp_path/'db.sqlite3',Limits(session_ttl_seconds=30),clock=lambda:now[0])
    store.initialize()
    token,_ = store.create(STORY)
    with store.connection() as db,db:
        db.execute('DROP TABLE session_activity')
    now[0] += 1000
    store.initialize()
    assert store.get(token).story_id == STORY.id
    now[0] += 31
    store.initialize()  # initialization must not renew existing metadata
    with pytest.raises(AppError):
        store.get(token)


def test_capacity_and_command_quota_stop_writes_before_ai(tmp_path):
    class Spy:
        calls = 0
        async def generate(self,**kwargs):
            self.calls += 1
            return AIOutput(reply='回复')
    spy = Spy()
    app = create_app(tmp_path/'db.sqlite3',ai=spy,limits=Limits(max_sessions=1,max_commands_per_session=1))
    with TestClient(app) as client:
        created = client.post('/api/sessions').json()
        assert client.post('/api/sessions').json()['error']['code'] == 'SESSION_CAPACITY'
        headers = {'Authorization':f"Bearer {created['token']}"}
        body = {'request_id':str(uuid4()),'expected_version':0,'target_id':'camera_front'}
        first = client.post('/api/inspect',headers=headers,json=body)
        assert first.status_code == 200
        assert client.post('/api/inspect',headers=headers,json=body).json() == first.json()
        response = client.post('/api/chat',headers=headers,json={
            'request_id':str(uuid4()),'expected_version':1,'message':'你好',
        })
        assert response.json()['error']['code'] == 'SESSION_COMMAND_LIMIT'
        assert spy.calls == 0


def test_storage_quota_rejects_new_session(tmp_path):
    with TestClient(create_app(tmp_path/'db.sqlite3',limits=Limits(max_database_bytes=1))) as client:
        assert client.post('/api/sessions').json()['error']['code'] == 'STORAGE_QUOTA'


def test_backup_and_restore_preserve_token_progress_and_daily_budget(tmp_path):
    store = Store(tmp_path/'source.sqlite3',Limits(ai_daily_calls=1))
    store.initialize()
    token,state = store.create(STORY)
    store.commit(state,0,str(uuid4()),'fixture-fingerprint')
    store.reserve_ai_call()
    backup = backup_database(store.path,tmp_path/'backup.sqlite3')
    restored_path = backup_database(backup,tmp_path/'restored.sqlite3')
    restored = Store(restored_path,store.limits)
    restored.initialize()
    assert restored.get(token).version == 1
    with pytest.raises(AppError):
        restored.reserve_ai_call()
    with pytest.raises(FileExistsError):
        backup_database(backup,restored_path)
    assert restored.get(token).version == 1
    assert restored_path.stat().st_mode & 0o777 == 0o600


def test_wal_disappearing_between_size_checks_is_normal(tmp_path, monkeypatch):
    store = Store(tmp_path/'db.sqlite3')
    store.initialize()
    wal = Path(str(store.path)+'-wal')
    assert not wal.exists()
    exists = Path.exists
    # Simulate a WAL that existed just before the final connection closed.
    monkeypatch.setattr(Path,'exists',lambda path: True if path == wal else exists(path))
    store.check_storage()


def test_active_read_renewal_is_atomic_with_expiry_cleanup(tmp_path, monkeypatch):
    import time
    from contextlib import contextmanager
    from threading import Event
    now = [1000.0]
    store = Store(tmp_path/'db.sqlite3',Limits(session_ttl_seconds=30),clock=lambda:now[0])
    store.initialize()
    token,_ = store.create(STORY)
    selected,release = Event(),Event()
    original = store.connection
    class Cursor:
        def __init__(self, cursor): self.cursor=cursor
        def fetchone(self):
            row=self.cursor.fetchone()
            self.cursor.close()
            selected.set()
            assert release.wait(timeout=3)
            return row
    class Connection:
        def __init__(self, db): self.db=db
        def __enter__(self): self.db.__enter__(); return self
        def __exit__(self,*args): return self.db.__exit__(*args)
        def execute(self,sql,params=()):
            cursor=self.db.execute(sql,params)
            return Cursor(cursor) if sql.startswith('SELECT s.id') else cursor
    @contextmanager
    def connection():
        with original() as db:
            yield Connection(db)
    monkeypatch.setattr(store,'connection',connection)
    now[0]=1029.9
    with ThreadPoolExecutor(2) as pool:
        reader=pool.submit(store.get,token)
        assert selected.wait(timeout=2)
        now[0]=1030.1
        cleaner=pool.submit(store.cleanup,dry_run=False)
        time.sleep(.03)
        release.set()
        assert reader.result(timeout=3).version == 0
        assert cleaner.result(timeout=3)['expired_sessions'] == 0
    with original() as db:
        assert db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0] == 1
