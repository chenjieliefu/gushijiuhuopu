import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from threading import Lock
from concurrent.futures import ThreadPoolExecutor

import pytest
import tos
from app.tos_store import TosStore
from app.models import Story
from app.errors import AppError
from app.limits import Limits


class MemoryTos:
    def __init__(self):
        self.objects = {}
        self.lock = Lock()
        self.fail_after_save = False

    def error(self, status):
        response = SimpleNamespace(request_id='test', headers={}, status=status)
        return tos.exceptions.TosServerError(response, 'test', 'test', '', '')

    def get_object(self, bucket, key):
        with self.lock:
            if key not in self.objects:
                raise self.error(404)
            data = self.objects[key]
            return SimpleNamespace(read=lambda: data, etag=hashlib.md5(data).hexdigest())

    def put_object(self, bucket, key, *, content, forbid_overwrite=False, if_match=None, **kwargs):
        with self.lock:
            current = self.objects.get(key)
            if forbid_overwrite and current is not None:
                raise self.error(409)
            if if_match and (current is None or hashlib.md5(current).hexdigest() != if_match):
                raise self.error(412)
            self.objects[key] = content
            if self.fail_after_save:
                self.fail_after_save = False
                raise tos.exceptions.TosClientError('simulated lost response')
            return SimpleNamespace(etag=hashlib.md5(content).hexdigest())

    def list_objects_type2(self, bucket, prefix):
        with self.lock:
            return SimpleNamespace(contents=[SimpleNamespace(key=k, size=len(v))
                                             for k, v in self.objects.items() if k.startswith(prefix)])


def setup(limits=None):
    client = MemoryTos()
    def store():
        return TosStore(client=client, bucket='private', prefix='game', limits=limits)
    story = Story.model_validate_json(Path('stories/lost-sunshine.json').read_text())
    return client, store, story


def test_cloud_save_survives_replacement_and_isolates_players():
    _, factory, story = setup()
    first = factory()
    token, state = first.create(story)
    other_token, other = first.create(story)
    state.summary = 'saved progress'
    saved = first.commit(state, 0, 'request-1', 'fingerprint')
    replacement = factory()
    assert replacement.get(token) == saved
    assert replacement.get(other_token) == other
    with pytest.raises(AppError) as denied:
        replacement.get(state.session_id)  # object ID does not confer access
    assert denied.value.status == 401
    assert replacement.replay(state.session_id, 'request-1', 'fingerprint') == saved
    with pytest.raises(AppError) as conflict:
        replacement.replay(state.session_id, 'request-1', 'different')
    assert conflict.value.code == 'IDEMPOTENCY_CONFLICT'


def test_concurrent_instances_cannot_overwrite_each_other():
    _, factory, story = setup()
    token, state = factory().create(story)
    def update(i):
        candidate = state.model_copy(deep=True)
        candidate.summary = str(i)
        try:
            return factory().commit(candidate, 0, str(i), str(i))
        except AppError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(update, [1, 2]))
    assert results.count('VERSION_CONFLICT') == 1
    assert factory().get(token).version == 1


def test_uncertain_write_can_retry_without_duplicate_progress():
    client, factory, story = setup()
    token, state = factory().create(story)
    client.fail_after_save = True
    with pytest.raises(AppError) as error:
        factory().commit(state, 0, 'same-request', 'same-fingerprint')
    assert error.value.status == 503
    saved = factory().commit(state, 0, 'same-request', 'same-fingerprint')
    assert saved.version == 1
    assert factory().get(token).version == 1


def test_daily_ai_budget_is_shared_across_instances():
    _, factory, _ = setup(Limits(ai_daily_calls=1))
    factory().reserve_ai_call()
    with pytest.raises(AppError) as error:
        factory().reserve_ai_call()
    assert error.value.code == 'AI_DAILY_LIMIT'
