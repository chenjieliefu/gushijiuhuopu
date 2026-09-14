"""Serve the built game and its API on one origin for cloud deployments."""
import os
from pathlib import Path

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.main import ROOT, create_app


class GameAssets(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 206, 304):
            response.headers['Cache-Control'] = (
                'public, max-age=31536000, immutable' if path.startswith('assets/')
                else 'public, max-age=3600'
            )
        return response


def create_web_app(**kwargs):
    public = Path(os.getenv('FRONTEND_DIST', str(ROOT / 'frontend/dist'))).resolve()
    if not (public / 'index.html').is_file():
        raise RuntimeError('Build the frontend before starting the web application')
    app = create_app(**kwargs)
    # The API-only entry point keeps its /docs redirect for local development.
    app.router.routes = [route for route in app.router.routes if getattr(route, 'path', None) != '/']

    @app.get('/', include_in_schema=False)
    def index():
        return FileResponse(public / 'index.html')

    # Mount last: existing API routes take precedence. StaticFiles rejects paths
    # outside this directory and returns 404 for missing assets, never index.html.
    app.mount('/', GameAssets(directory=public), name='game-assets')
    return app


def __getattr__(name):
    if name == 'app':
        global app
        app = create_web_app()
        return app
    raise AttributeError(name)
