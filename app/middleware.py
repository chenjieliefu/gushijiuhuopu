"""Outer ASGI middleware also covers errors emitted by ServerErrorMiddleware."""
import logging
import time
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import MutableHeaders

from app.operations import OperationalMiddleware

logger = logging.getLogger('story_shop')


class RequestContextMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        trace = str(uuid4())
        scope.setdefault('state', {})['trace_id'] = trace
        started = time.monotonic()
        status = 500
        async def traced_send(message):
            nonlocal status
            if message['type'] == 'http.response.start':
                status = message['status']
                headers = MutableHeaders(scope=message)
                headers['X-Request-ID'] = trace
                if scope['path'].startswith('/api/') or scope['path'] in {'/', '/health'}:
                    headers['Cache-Control'] = 'no-store'
            await send(message)
        try:
            await self.app(scope, receive, traced_send)
        finally:
            logger.info('request method=%s path=%s status=%s duration_ms=%.1f trace_id=%s',
                        scope['method'], scope['path'], status,
                        (time.monotonic() - started) * 1000, trace)


class Application(FastAPI):
    def build_middleware_stack(self):
        cors = CORSMiddleware(
            OperationalMiddleware(super().build_middleware_stack(), self.state.limits), allow_origins=self.state.cors_origins,
            allow_credentials=False, allow_methods=['GET', 'POST'],
            allow_headers=['Authorization', 'Content-Type'], expose_headers=['X-Request-ID', 'Retry-After'],
        )
        return RequestContextMiddleware(cors)
