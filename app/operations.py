"""Bounded in-memory rate limits and request-body protection at the ASGI boundary."""
import time

from starlette.datastructures import Headers
from starlette.responses import JSONResponse

from app.limits import Limits


class OperationalMiddleware:
    def __init__(self, app, limits: Limits, clock=time.monotonic):
        self.app, self.limits, self.clock = app, limits, clock
        self.buckets: dict[tuple[str, str], tuple[int, float]] = {}
        self.max_buckets = 4096

    async def reject(self, scope, receive, send, status, code, message, retry_after=None):
        response = JSONResponse({'error':{'code':code,'message':message,
                                'trace_id':scope.get('state',{}).get('trace_id')}}, status_code=status,
                                headers={'Retry-After':str(retry_after)} if retry_after else None)
        await response(scope, receive, send)

    def admit(self, peer, group, limit, window):
        now = self.clock()
        key = (peer, group)
        previous = self.buckets.get(key)
        if previous is None or previous[1] <= now:
            if len(self.buckets) >= self.max_buckets:
                self.buckets = {key:value for key,value in self.buckets.items() if value[1] > now}
            if key not in self.buckets and len(self.buckets) >= self.max_buckets:
                return 60  # Fail closed; rotating addresses cannot grow memory without bound.
            previous = (0, now + window)
        count, until = previous
        if count >= limit:
            return max(1, int(until - now) + 1)
        self.buckets[key] = (count + 1, until)
        return 0

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith('/api/'):
            return await self.app(scope, receive, send)
        # Forwarded headers are intentionally not parsed here. Uvicorn may replace
        # scope.client only when the immediate proxy is explicitly trusted.
        peer = (scope.get('client') or ('unknown',0))[0]
        retry = self.admit(peer, 'all', self.limits.requests_per_minute, 60)
        if not retry and scope['method'] == 'POST':
            if scope['path'] == '/api/sessions':
                retry = self.admit(peer, 'sessions', self.limits.sessions_per_hour, 3600)
            elif scope['path'] == '/api/chat':
                retry = self.admit(peer, 'chat', self.limits.chats_per_minute, 60)
        if retry:
            return await self.reject(scope, receive, send, 429, 'RATE_LIMITED', '操作过于频繁，请稍后重试', retry)
        if scope['method'] == 'POST':
            length = Headers(scope=scope).get('content-length')
            try:
                too_large = length is not None and int(length) > self.limits.max_request_bytes
            except ValueError:
                return await self.reject(scope, receive, send, 400, 'INVALID_REQUEST', '请求长度无效')
            if too_large:
                return await self.reject(scope, receive, send, 413, 'REQUEST_TOO_LARGE', '请求内容过大')
            parts, size = [], 0
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect':
                    return
                chunk = message.get('body', b'')
                size += len(chunk)
                if size > self.limits.max_request_bytes:
                    return await self.reject(scope, receive, send, 413, 'REQUEST_TOO_LARGE', '请求内容过大')
                parts.append(chunk)
                if not message.get('more_body', False):
                    break
            consumed = False
            async def bounded_receive():
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {'type':'http.request','body':b''.join(parts),'more_body':False}
                return await receive()
            return await self.app(scope, bounded_receive, send)
        return await self.app(scope, receive, send)
