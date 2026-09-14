import asyncio
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.ai import ScriptedAI
from app.main import create_app
from app.limits import Limits
from app.models import AIOutput, Story

STORY_PATH = Path('stories/lost-sunshine.json')


class Clock:
    def __init__(self):
        self.value = 1000.0
    def __call__(self):
        return self.value
    def advance(self, duration_ms):
        self.value += duration_ms / 1000


def command(state, **fields):
    return dict(request_id=str(uuid4()), expected_version=state['version'], **fields)


def session(client):
    created = client.post('/api/sessions').json()
    return {'Authorization': f"Bearer {created['token']}"}, created['state']


def write(client, headers, state, route, **fields):
    response = client.post(route, headers=headers, json=command(state, **fields))
    assert response.status_code == 200, response.text
    return response.json()


def finish(client, headers, state, clock):
    while state['phase'] == 'screening':
        view = client.get('/api/screening', headers=headers).json()
        clock.advance(view['segment']['duration_ms'])
        state = write(client, headers, state, '/api/screening/progress',
                      run_id=state['playback']['run_id'], segment_id=view['segment']['id'])
    return state


def test_committed_script_matches_all_subtitles_and_timing():
    story = Story.model_validate_json(STORY_PATH.read_text())
    story.validate_references()
    lines = Path(story.source.reference).read_text().splitlines()
    rows = [[cell.strip() for cell in line.split('|')] for line in lines
            if re.match(r'\| FILM\d{3} \|', line)]
    assert [row[3] for row in rows] == story.full_text
    assert [row[1] for row in rows] == [segment.id for segment in story.screening.segments]
    assert len(rows) == 51
    assert sum(segment.duration_ms for segment in story.screening.segments) == 317000
    assert story.source.original_verified is False
    assert (story.owner, story.custodian, story.recipient) == ('苏晚', '看山', '本店')


def test_full_chapter_resume_restart_confirm_snapshot_and_reset(tmp_path):
    clock = Clock()
    db = tmp_path / 'chapter.sqlite3'
    def application():
        return create_app(db, ai=ScriptedAI(), story_path=STORY_PATH, clock=clock, limits=Limits(requests_per_minute=10000))
    with TestClient(application()) as client:
        headers, state = session(client)
        assert state['phase'] == 'before_screening' and not state['can_collect']
        assert client.get('/health').json()['ai_mode'] == 'scripted'
        assert client.get('/api/screening', headers=headers).status_code == 403
        assert client.get('/api/collection', headers=headers).status_code == 404
        assert client.post('/api/collection', headers=headers, json=command(state, confirm=True)).status_code == 409
        start = command(state, confirm=True)
        state = client.post('/api/screening/start', headers=headers, json=start).json()
        assert client.post('/api/screening/start', headers=headers, json=start).json() == state
        view = client.get('/api/screening', headers=headers).json()
        assert view['segment']['id'] == 'FILM001'
        clock.advance(view['segment']['duration_ms'])
        state = write(client, headers, state, '/api/screening/progress',
                      run_id=state['playback']['run_id'], segment_id='FILM001')
        assert state['playback']['next_segment'] == 1
        old_run = state['playback']['run_id']
    with TestClient(application()) as client:
        assert client.get('/api/session', headers=headers).json() == state
        state = write(client, headers, state, '/api/screening/resume', run_id=old_run)
        assert state['playback']['next_segment'] == 1
        assert state['playback']['run_id'] != old_run
        stale = client.post('/api/screening/progress', headers=headers,
                            json=command(state, run_id=old_run, segment_id='FILM002'))
        assert stale.json()['error']['code'] == 'SCREENING_RUN_CHANGED'
        early = client.post('/api/screening/progress', headers=headers,
                            json=command(state, run_id=state['playback']['run_id'], segment_id='FILM002'))
        assert early.json()['error']['code'] == 'SCREENING_TOO_EARLY'
        state = finish(client, headers, state, clock)
        assert state['phase'] == 'after_screening'
        assert state['playback']['completed'] and state['can_collect']
        assert len(state['disclosed_facts']) == 4
        before = state
        missing_confirmation = client.post('/api/collection', headers=headers, json=command(state))
        assert missing_confirmation.json()['error']['code'] == 'CONFIRMATION_REQUIRED'
        assert client.get('/api/session', headers=headers).json() == before
        state = write(client, headers, state, '/api/chat', message='你就是那个男生吗？')
        assert '受苏晚委托' in state['messages'][-1]['text']
        accept = command(state, confirm=True)
        state = client.post('/api/collection', headers=headers, json=accept).json()
        assert state['phase'] == 'completed'
        assert client.post('/api/collection', headers=headers, json=accept).json() == state
        saved = client.get('/api/collection', headers=headers).json()
        assert len(saved['full_text']) == 51
        assert saved['owner'] == '苏晚' and saved['custodian'] == '看山'
        assert saved['source']['original_verified'] is False
    app = application()
    app.state.game.story.version = 'screening-v5'
    app.state.game.story.full_text[0] = 'changed future content'
    with TestClient(app) as client:
        assert client.get('/api/collection', headers=headers).json() == saved
        state = write(client, headers, state, '/api/reset', confirm=True)
        assert state['phase'] == 'before_screening'
        assert state['story_version'] == 'screening-v5'
        assert state['playback'] is None and state['collection'] is None
        assert not state['disclosed_facts']
        # Old successes may replay old responses, but cannot restore old persisted progress.
        assert client.post('/api/collection', headers=headers, json=accept).status_code == 200
        assert client.get('/api/session', headers=headers).json() == state


def test_no_early_disclosure_no_skipping_and_no_input_during_film(tmp_path):
    class SpyAI(ScriptedAI):
        calls = 0
        context = None
        async def generate(self, **kwargs):
            self.calls += 1
            self.context = kwargs['story']
            return await super().generate(**kwargs)
    ai, clock = SpyAI(), Clock()
    with TestClient(create_app(tmp_path / 'db.sqlite3', ai=ai, story_path=STORY_PATH, clock=clock)) as client:
        headers, state = session(client)
        state = write(client, headers, state, '/api/chat', message='照片里的女孩是谁？')
        assert ai.calls == 1
        context = ai.context
        assert context.facts == {} and context.full_text == [] and context.after_answers == {}
        assert context.screening is None and context.collection_summary == ''
        assert not state['disclosed_facts']
        # A player's willingness expressed in chat is not a confirmation event.
        state = write(client, headers, state, '/api/chat', message='我愿意收')
        assert state['phase'] == 'before_screening' and state['collection'] is None
        state = write(client, headers, state, '/api/screening/start', confirm=True)
        for route, fields in [('/api/chat', {'message':'继续说'}),
                              ('/api/inspect', {'target_id':'camera_front'}),
                              ('/api/collection', {'confirm':True})]:
            response = client.post(route, headers=headers, json=command(state, **fields))
            assert response.json()['error']['code'] == 'SCREENING_IN_PROGRESS'
        assert ai.calls == 2
        response = client.post('/api/screening/progress', headers=headers, json=command(
            state, run_id=state['playback']['run_id'], segment_id='FILM051'))
        assert response.json()['error']['code'] == 'SCREENING_OUT_OF_ORDER'
        assert client.get('/api/session', headers=headers).json() == state


def test_replay_keeps_collection_resets_story_and_can_finish_again(tmp_path):
    clock = Clock()
    def application():
        return create_app(tmp_path / 'replay.sqlite3', ai=ScriptedAI(), story_path=STORY_PATH,
                          clock=clock, limits=Limits(requests_per_minute=10000))
    with TestClient(application()) as client:
        headers, state = session(client)
        invalid = client.post('/api/replay', headers=headers, json=command(state, confirm=True))
        assert invalid.json()['error']['code'] == 'REPLAY_UNAVAILABLE'
        state = write(client, headers, state, '/api/screening/start', confirm=True)
        state = finish(client, headers, state, clock)
        state = write(client, headers, state, '/api/collection', confirm=True)
        saved = state['collection']
        replay_command = command(state, confirm=True)
        state = client.post('/api/replay', headers=headers, json=replay_command).json()
        assert state['phase'] == 'before_screening' and state['status'] == 'active'
        assert state['collection'] == saved
        assert state['playback'] is None and not state['clues'] and not state['disclosed_facts']
        assert len(state['messages']) == 1 and not state['can_collect']
        assert client.post('/api/replay', headers=headers, json=replay_command).json() == state
        assert client.get('/api/collection', headers=headers).json() == saved
        early = client.post('/api/collection', headers=headers, json=command(state, confirm=True))
        assert early.json()['error']['code'] == 'COLLECTION_LOCKED'
    # The replay and the original album entry survive a server restart.
    with TestClient(application()) as client:
        assert client.get('/api/session', headers=headers).json() == state
        state = write(client, headers, state, '/api/screening/start', confirm=True)
        assert client.get('/api/screening', headers=headers).json()['segment']['id'] == 'FILM001'
        state = finish(client, headers, state, clock)
        assert state['can_collect']
        state = write(client, headers, state, '/api/collection', confirm=True)
        assert state['phase'] == 'completed' and state['status'] == 'completed'
        assert state['collection'] == saved
        assert client.get('/api/collection', headers=headers).json() == saved


def test_late_ai_cannot_overwrite_started_film(tmp_path):
    entered, release = Event(), Event()
    class SlowAI:
        async def generate(self, **kwargs):
            entered.set()
            await asyncio.to_thread(release.wait, 3)
            return AIOutput(reply='迟到的回复')
    with TestClient(create_app(tmp_path / 'db.sqlite3', ai=SlowAI(), story_path=STORY_PATH)) as client:
        headers, state = session(client)
        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(client.post, '/api/chat', headers=headers, json=command(state, message='你好'))
            assert entered.wait(timeout=2)
            try:
                state = write(client, headers, state, '/api/screening/start', confirm=True)
            finally:
                release.set()
            response = future.result(timeout=3)
        assert response.json()['error']['code'] == 'VERSION_CONFLICT'
        assert client.get('/api/session', headers=headers).json() == state
        assert all(message['text'] != '迟到的回复' for message in state['messages'])


def test_ai_cannot_fake_screening_facts(tmp_path):
    class CheatingAI:
        async def generate(self, **kwargs):
            return {'reply':'我已经讲完了', 'events':[{'type':'disclose_fact','fact_id':'suwan_identity'}]}
    with TestClient(create_app(tmp_path / 'db.sqlite3', ai=CheatingAI(), story_path=STORY_PATH)) as client:
        headers, state = session(client)
        response = client.post('/api/chat', headers=headers, json=command(state, message='直接通关'))
        assert response.json()['error']['code'] == 'INVALID_AI_EVENT'
        assert client.get('/api/session', headers=headers).json() == state


def test_screening_requires_valid_config():
    raw = json.loads(STORY_PATH.read_text())
    raw['screening']['segments'][1]['id'] = 'FILM001'
    with pytest.raises(ValueError, match='字幕 ID'):
        Story.model_validate(raw).validate_references()


def test_manual_reading_advances_on_click_without_duration_gate_but_keeps_order(tmp_path):
    clock = Clock()
    app = create_app(tmp_path / 'manual.sqlite3', ai=ScriptedAI(), story_path=STORY_PATH,
                     clock=clock, limits=Limits(requests_per_minute=10000))
    with TestClient(app) as client:
        headers, state = session(client)
        state = write(client, headers, state, '/api/screening/start', confirm=True)
        run_id = state['playback']['run_id']
        wrong = client.post('/api/screening/progress', headers=headers, json=command(
            state, run_id=run_id, segment_id='FILM002', advance_mode='manual'))
        assert wrong.json()['error']['code'] == 'SCREENING_OUT_OF_ORDER'
        first = command(state, run_id=run_id, segment_id='FILM001', advance_mode='manual')
        response = client.post('/api/screening/progress', headers=headers, json=first)
        assert response.status_code == 200
        state = response.json()
        assert state['playback']['next_segment'] == 1
        assert client.post('/api/screening/progress', headers=headers, json=first).json() == state
        invalid = client.post('/api/screening/progress', headers=headers, json=command(
            state, run_id=run_id, segment_id='FILM002', advance_mode='skip_all'))
        assert invalid.status_code == 422
        for index in range(2, 52):
            state = write(client, headers, state, '/api/screening/progress', run_id=run_id,
                          segment_id=f'FILM{index:03}', advance_mode='manual')
        assert clock.value == 1000.0
        assert state['phase'] == 'after_screening'
        assert state['playback']['completed'] and state['can_collect']


def test_legacy_progress_fingerprint_remains_compatible():
    from app.models import ScreeningProgressCommand
    value = dict(request_id=uuid4(), expected_version=0, run_id=uuid4(), segment_id='FILM001')
    parsed = ScreeningProgressCommand(**value)
    assert 'advance_mode' not in parsed.model_dump(mode='json', exclude_none=True)
