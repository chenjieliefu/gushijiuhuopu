"""Durable cloud sessions; conditional object writes preserve optimistic concurrency.

Each private object contains one session and its idempotency responses. TOS is the
source of truth: no local database or in-memory save is needed after a restart.
"""
import json
import os
import secrets
import time
from datetime import datetime, timezone

import tos
from app.errors import AppError
from app.models import State
from app.store import Store, fresh_state, token_hash
from app.limits import Limits


class TosStore:
    fingerprint = staticmethod(Store.fingerprint)

    def __init__(self, *, client, bucket, prefix, limits=None, clock=time.time):
        if not prefix.strip('/') or '..' in prefix:
            raise ValueError('TOS_PREFIX must be an isolated nonempty prefix')
        self.client, self.bucket = client, bucket
        self.prefix = prefix.strip('/') + '/'
        self.limits, self.clock = limits or Limits(), clock

    @classmethod
    def from_env(cls, **kwargs):
        client = tos.TosClientV2(
            os.environ['TOS_ACCESS_KEY_ID'], os.environ['TOS_SECRET_ACCESS_KEY'],
            endpoint=os.environ['TOS_ENDPOINT'], region=os.environ['TOS_REGION'],
            connection_time=5, socket_timeout=15, max_retry_count=1,
        )
        return cls(client=client, bucket=os.environ['TOS_BUCKET'],
                   prefix=os.environ['TOS_PREFIX'], **kwargs)

    def _key(self, session_id):
        return f'sessions/{session_id}.json'

    def _get(self, key):
        try:
            output = self.client.get_object(self.bucket, self.prefix + key)
            return json.loads(output.read()), output.etag
        except tos.exceptions.TosServerError as exc:
            if exc.status_code == 404:
                return None, None
            raise AppError(503, 'STORAGE_UNAVAILABLE', '云端存档暂不可用，请稍后重试') from None
        except (tos.exceptions.TosClientError, ValueError):
            raise AppError(503, 'STORAGE_UNAVAILABLE', '云端存档暂不可用，请稍后重试') from None

    def _put(self, key, data, etag=None):
        body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
        if len(body) > self.limits.max_database_bytes:
            raise AppError(503, 'STORAGE_QUOTA', '存档已达配额')
        try:
            self.client.put_object(self.bucket, self.prefix + key, content=body,
                                   content_type='application/json',
                                   forbid_overwrite=etag is None, if_match=etag)
            return True
        except tos.exceptions.TosServerError as exc:
            if exc.status_code in (409, 412):
                return False
            raise AppError(503, 'STORAGE_UNAVAILABLE', '云端存档暂不可用，请用原请求重试') from None
        except tos.exceptions.TosClientError:
            # An uncertain network result must not be acknowledged as saved.
            # The persisted request ID makes a later retry safe.
            raise AppError(503, 'STORAGE_UNAVAILABLE', '云端存档暂不可用，请用原请求重试') from None

    def _objects(self, directory='sessions/'):
        try:
            result = self.client.list_objects_type2(self.bucket, prefix=self.prefix + directory)
            return result.contents
        except (tos.exceptions.TosClientError, tos.exceptions.TosServerError):
            raise AppError(503, 'STORAGE_UNAVAILABLE', '云端存档暂不可用，请稍后重试') from None

    def initialize(self):
        self.health()

    def health(self):
        # No writes or private data returned by the health endpoint.
        self._objects()

    def check_storage(self):
        if sum(obj.size for obj in self._objects()) >= self.limits.max_database_bytes:
            raise AppError(503, 'STORAGE_QUOTA', '存储已达配额，请管理员处理')

    def create(self, story):
        objects = self._objects()
        if len(objects) >= self.limits.max_sessions:
            raise AppError(503, 'SESSION_CAPACITY', '体验人数已达当前容量，请稍后再试')
        if sum(obj.size for obj in objects) >= self.limits.max_database_bytes:
            raise AppError(503, 'STORAGE_QUOTA', '存储已达配额，请管理员处理')
        token = secrets.token_urlsafe(32)
        # A hash identifies the object but is never accepted as a bearer token.
        state = fresh_state(token_hash(token), story)
        data = {'state': state.model_dump(mode='json'), 'requests': {}, 'last_seen': self.clock()}
        if not self._put(self._key(state.session_id), data):
            raise AppError(503, 'STORAGE_UNAVAILABLE', '创建存档失败，请重试')
        return token, state

    def _session(self, session_id):
        data, etag = self._get(self._key(session_id))
        if data is None or data['last_seen'] < self.clock() - self.limits.session_ttl_seconds:
            raise AppError(401, 'INVALID_SESSION', '会话无效或已过期，请开始新的体验')
        return data, etag

    def get(self, token):
        session_id = token_hash(token)
        for _ in range(4):
            data, etag = self._session(session_id)
            if self.clock() - data['last_seen'] < min(60, self.limits.session_ttl_seconds / 2):
                return State.model_validate(data['state'])
            data['last_seen'] = self.clock()
            if self._put(self._key(session_id), data, etag):
                return State.model_validate(data['state'])
        raise AppError(409, 'VERSION_CONFLICT', '进度已更新，请重新读取')

    def check_command_capacity(self, session_id):
        self.check_storage()
        data, _ = self._session(session_id)
        if len(data['requests']) >= self.limits.max_commands_per_session:
            raise AppError(409, 'SESSION_COMMAND_LIMIT', '当前会话操作记录已达上限')

    @staticmethod
    def _replay(data, request_id, fingerprint):
        previous = data['requests'].get(request_id)
        if previous is None:
            return None
        if previous['fingerprint'] != fingerprint:
            raise AppError(409, 'IDEMPOTENCY_CONFLICT', '同一 request_id 不能用于不同请求')
        return State.model_validate(previous['response'])

    def replay(self, session_id, request_id, fingerprint):
        data, _ = self._session(session_id)
        return self._replay(data, request_id, fingerprint)

    def commit(self, state, expected_version, request_id, fingerprint):
        for _ in range(4):
            data, etag = self._session(state.session_id)
            previous = self._replay(data, request_id, fingerprint)
            if previous is not None:
                return previous
            if data['state']['version'] != expected_version:
                raise AppError(409, 'VERSION_CONFLICT', '进度已更新，请重新读取后再操作')
            if len(data['requests']) >= self.limits.max_commands_per_session:
                raise AppError(409, 'SESSION_COMMAND_LIMIT', '当前会话操作记录已达上限')
            state.version = expected_version + 1
            data['state'] = state.model_dump(mode='json')
            data['last_seen'] = max(data['last_seen'], self.clock())
            data['requests'][request_id] = {'fingerprint': fingerprint, 'response': data['state']}
            if self._put(self._key(state.session_id), data, etag):
                return state
        raise AppError(409, 'VERSION_CONFLICT', '进度已更新，请重新读取后再操作')

    def reserve_ai_call(self):
        day = datetime.fromtimestamp(self.clock(), timezone.utc).date().isoformat()
        key = 'usage/' + day + '.json'
        for _ in range(8):
            data, etag = self._get(key)
            attempts = data['attempts'] if data else 0
            if attempts >= self.limits.ai_daily_calls:
                raise AppError(429, 'AI_DAILY_LIMIT', '今日回复调用预算已用完，请稍后再试')
            if self._put(key, {'attempts': attempts + 1}, etag):
                return
        raise AppError(429, 'AI_BUSY', '回复服务繁忙，请稍后重试')

    def cleanup(self, *, dry_run=True):
        # Objects are durable recovery copies. Avoid a read/delete race with an
        # active player. Expired credentials are refused by _session; an operator
        # can archive expired objects during a maintenance window.
        return {'dry_run': True, 'retention': 'private-cloud-archive'}
