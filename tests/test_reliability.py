import asyncio
import json
import sqlite3
import threading
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.models import InspectCommand


def test_empty_prerequisite_pages_unlocked_at_creation_and_reset(tmp_path, monkeypatch):
    story = json.loads(Path('stories/demo.json').read_text())
    story['pages']['demo_page']['requires_facts'] = []
    path = tmp_path / 'story.json'
    path.write_text(json.dumps(story))
    monkeypatch.setenv('STORY_PATH', str(path))
    with TestClient(create_app(tmp_path / 'db.sqlite3')) as client:
        created = client.post('/api/sessions').json()
        headers = {'Authorization': f"Bearer {created['token']}"}
        assert client.get('/api/pages/demo_page', headers=headers).status_code == 200
        response = client.post('/api/reset', headers=headers, json={
            'request_id': str(uuid4()), 'expected_version': 0, 'confirm': True,
        })
        assert response.status_code == 200
        assert client.get('/api/pages/demo_page', headers=headers).status_code == 200


def test_unexpected_errors_keep_cors_trace_and_private_cache_headers(tmp_path, monkeypatch, caplog):
    monkeypatch.setenv('CORS_ORIGINS', 'http://localhost:5178')
    app = create_app(tmp_path / 'db.sqlite3')
    def broken_get(token):
        raise RuntimeError('secret-test-string')
    monkeypatch.setattr(app.state.game.store, 'get', broken_get)
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get('/api/session', headers={
            'Origin': 'http://localhost:5178', 'Authorization': 'Bearer local-test',
        })
    assert response.status_code == 500
    assert response.headers['access-control-allow-origin'] == 'http://localhost:5178'
    assert response.headers['cache-control'] == 'no-store'
    trace = response.json()['error']['trace_id']
    assert response.headers['x-request-id'] == trace
    assert trace in caplog.text
    assert 'secret-test-string' not in caplog.text


def test_sqlite_lock_wait_does_not_block_event_loop(tmp_path):
    app = create_app(tmp_path / 'db.sqlite3')
    game = app.state.game
    game.store.initialize()
    token, state = game.store.create(game.story)
    ready, release = threading.Event(), threading.Event()
    def hold_lock():
        with sqlite3.connect(game.store.path) as db:
            db.execute('BEGIN IMMEDIATE')
            ready.set()
            release.wait(timeout=2)
    thread = threading.Thread(target=hold_lock)
    thread.start()
    assert ready.wait(timeout=2)
    async def exercise():
        task = asyncio.create_task(game.execute(token, 'inspect', InspectCommand(
            request_id=uuid4(), expected_version=state.version, target_id='camera_front',
        )))
        await asyncio.sleep(0.05)
        try:
            # The timer must run while SQLite is still waiting on the other writer.
            assert thread.is_alive()
            assert not task.done()
        finally:
            release.set()
            await task
    try:
        asyncio.run(exercise())
    finally:
        release.set()
        thread.join(timeout=3)


def test_pre_upgrade_collection_request_still_replays(tmp_path):
    app = create_app(tmp_path / 'db.sqlite3')
    store = app.state.game.store
    store.initialize()
    token, state = store.create(app.state.game.story)
    state.status = 'completed'
    state.version = 5
    request = {'request_id': str(uuid4()), 'expected_version': 4}
    # This is the payload and State shape written by the previous deployed schema.
    payload = request | {'page_id': None}
    old = state.model_dump(mode='json', exclude={'phase', 'playback'})
    old['collection'] = {'story_id': state.story_id, 'item_name': '测试相机', 'summary': '已接收'}
    with sqlite3.connect(store.path) as db:
        db.execute('UPDATE sessions SET state_json=?, version=5 WHERE id=?', (json.dumps(old), state.session_id))
        db.execute('INSERT INTO requests VALUES (?, ?, ?, ?)', (
            state.session_id, request['request_id'], store.fingerprint('collect', payload), json.dumps(old),
        ))
    with TestClient(app) as client:
        headers = {'Authorization': f'Bearer {token}'}
        result = client.post('/api/collection', headers=headers, json=request)
        assert result.status_code == 200
        assert result.json()['version'] == 5
        assert result.json()['phase'] == 'completed'
        assert result.json()['collection']['summary'] == '已接收'
        assert client.get('/api/session', headers=headers).json() == result.json()
