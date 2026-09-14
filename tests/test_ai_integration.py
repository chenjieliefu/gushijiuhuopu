import asyncio
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from app.errors import AppError
from app.main import create_app
from app.models import AIOutput, ChatCommand


def test_shared_chat_survives_disconnect_and_capacity_rejects_new_calls(tmp_path):
    async def exercise():
        entered, release = asyncio.Event(), asyncio.Event()
        class Provider:
            calls = 0
            async def generate(self, **kwargs):
                self.calls += 1
                entered.set()
                await release.wait()
                return AIOutput(reply='共享回复')
        provider = Provider()
        game = create_app(tmp_path / 'db.sqlite3', ai=provider).state.game
        game.max_parallel_chats = 1
        game.store.initialize()
        token, _ = game.store.create(game.story)
        cmd = ChatCommand(request_id=uuid4(), expected_version=0, message='你好')
        first = asyncio.create_task(game.execute(token, 'chat', cmd))
        await entered.wait()
        second = asyncio.create_task(game.execute(token, 'chat', cmd))
        first.cancel()
        try:
            await first
        except asyncio.CancelledError:
            pass
        collision = cmd.model_copy(update={'message':'换一个问题'})
        try:
            await game.execute(token, 'chat', collision)
            raise AssertionError('fingerprint collision was accepted')
        except AppError as exc:
            assert exc.code == 'IDEMPOTENCY_CONFLICT'
        try:
            await game.execute(token, 'chat', cmd.model_copy(update={'request_id':uuid4()}))
            raise AssertionError('capacity limit was bypassed')
        except AppError as exc:
            assert exc.code == 'AI_BUSY'
        release.set()
        result = await second
        assert result.version == 1 and provider.calls == 1
        assert await game.execute(token, 'chat', cmd) == result
        assert provider.calls == 1
        assert not game.inflight
        await game.close()
    asyncio.run(exercise())


def test_custom_provider_factory_loads_without_fallback(tmp_path, monkeypatch):
    module = tmp_path / 'test_provider.py'
    module.write_text('''from app.models import AIOutput
class Provider:
    async def generate(self, **kwargs):
        return AIOutput(reply="已接入测试模块")
def create_provider():
    return Provider()
''')
    monkeypatch.syspath_prepend(str(tmp_path))
    monkeypatch.setenv('AI_MODE', 'custom')
    monkeypatch.setenv('AI_PROVIDER_FACTORY', 'test_provider:create_provider')
    app = create_app(tmp_path / 'db.sqlite3')
    assert app.state.game.ai.__class__.__module__ == 'test_provider'


def test_injected_provider_can_import_factory_without_constructing_global_app(tmp_path):
    # No provider factory configured: importing create_app must still allow explicit injection.
    env = os.environ | {'AI_MODE':'custom', 'AI_PROVIDER_FACTORY':'',
                        'STORY_PATH':str(Path('stories/lost-sunshine.json').resolve())}
    result = subprocess.run([sys.executable, '-c',
        'from app.main import create_app; from app.ai import ScriptedAI; '
        'application = create_app(ai=ScriptedAI()); '
        'assert application.state.game.story.flow == "screening"'],
        env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
