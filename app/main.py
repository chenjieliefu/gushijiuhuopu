import asyncio
import logging
import os
import sqlite3
import math
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.exceptions import HTTPException

from app.ai import AIProvider, MockAI, ScriptedAI, load_provider
from app.middleware import Application
from app.limits import Limits
from app.errors import AppError
from app.models import (ChatCommand, CollectCommand, Collection, Command, ConfirmCommand, ErrorEnvelope, InspectCommand, Page,
                        ResetCommand, ScreeningProgressCommand, ScreeningResumeCommand, ScreeningView, SessionCreated, State, Story)
from app.service import Game
from app.store import Store
from app.voice import VoiceRequest, dialogue_audio

ROOT = Path(__file__).resolve().parent.parent
security = HTTPBearer(auto_error=False)
logger = logging.getLogger("story_shop")


def bearer(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)]) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer" or len(credentials.credentials) > 200:
        raise AppError(401, "AUTH_REQUIRED", "请通过 Authorization: Bearer <token> 提供会话凭据")
    return credentials.credentials


Token = Annotated[str, Depends(bearer)]


def create_app(database_path: Path | None = None, ai: AIProvider | None = None,
               ai_timeout: float | None = None, story_path: Path | None = None, clock=time.time, limits: Limits | None = None):
    limits = limits or Limits.from_env()
    story = Story.model_validate_json((story_path or Path(os.getenv("STORY_PATH", str(ROOT / "stories/demo.json")))).read_text())
    story.validate_references()
    provider = ai if ai is not None else load_provider(os.getenv("AI_MODE", "mock"))
    if isinstance(provider, MockAI) and not story.is_test_fixture:
        raise ValueError("模拟 AI 只能使用明确标注 is_test_fixture=true 的测试配置；正式章节联调请用 scripted")
    if os.getenv('STORE_BACKEND', 'sqlite') == 'tos' and database_path is None:
        from app.tos_store import TosStore
        store = TosStore.from_env(limits=limits, clock=clock)
    else:
        store = Store(database_path or Path(os.getenv("DATABASE_PATH", str(ROOT / "data/story-shop.sqlite3"))), limits=limits, clock=clock)
    timeout = ai_timeout if ai_timeout is not None else float(os.getenv("AI_TIMEOUT_SECONDS", "10"))
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("AI_TIMEOUT_SECONDS 必须为有限正数")
    max_chats = int(os.getenv("AI_MAX_PARALLEL", "4"))
    if max_chats < 1:
        raise ValueError("AI_MAX_PARALLEL 必须大于 0")
    game = Game(store, story, provider, timeout, clock=clock, max_parallel_chats=max_chats)

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
        async def maintain():
            while True:
                try:
                    await asyncio.to_thread(store.cleanup, dry_run=False)
                except sqlite3.Error as exc:
                    logger.error("cleanup_failed type=%s", type(exc).__name__)
                await asyncio.sleep(limits.cleanup_interval_seconds)
        maintenance = asyncio.create_task(maintain())
        try:
            yield
        finally:
            maintenance.cancel()
            await asyncio.gather(maintenance, return_exceptions=True)
            await game.close()

    app = Application(
        title="故事旧货铺 · 后端联调 API", version="0.2.0", lifespan=lifespan,
        description="支持探索联调与正式章节连续放映。先查看 /health 的 AI 模式与内容核对状态。所有写操作携带 UUID request_id 与当前 expected_version。",
        responses={code: {"model": ErrorEnvelope} for code in (400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504)},
    )
    app.state.game = game
    app.state.limits = limits
    origins = [v.strip() for v in os.getenv("CORS_ORIGINS", "").split(",") if v.strip()]
    if "*" in origins:
        raise ValueError("CORS_ORIGINS 请填写具体前端来源")
    app.state.cors_origins = origins

    def error_response(request, status, code, message):
        headers = {"WWW-Authenticate": "Bearer"} if status == 401 else None
        return JSONResponse(status_code=status, headers=headers, content={"error": {
            "code": code, "message": message, "trace_id": getattr(request.state, "trace_id", None),
        }})

    @app.exception_handler(AppError)
    async def app_error(request, exc):
        return error_response(request, exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return error_response(request, 422, "INVALID_REQUEST", "请求格式无效，请按 /docs 的字段约定提交")

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error_response(request, exc.status_code, "HTTP_ERROR", str(exc.detail))

    @app.exception_handler(sqlite3.Error)
    async def database_error(request, exc):
        logger.error("database_failed type=%s trace_id=%s", type(exc).__name__, request.state.trace_id)
        return error_response(request, 503, "DATABASE_UNAVAILABLE", "存储暂不可用，请稍后使用原 request_id 重试")

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        logger.error("unexpected_error type=%s trace_id=%s", type(exc).__name__, request.state.trace_id)
        return error_response(request, 500, "INTERNAL_ERROR", "服务异常，请使用 trace_id 排查")

    @app.get("/", include_in_schema=False)
    async def index():
        return RedirectResponse("/docs")

    @app.get("/health", tags=["系统"])
    def health():
        store.health()
        return {"status": "ok", "ai_mode": "mock" if isinstance(game.ai, MockAI) else "scripted" if isinstance(game.ai, ScriptedAI) else "custom",
                "is_test_fixture": story.is_test_fixture, "flow": story.flow,
                "original_verified": story.source.original_verified}

    @app.get("/api/story", tags=["故事"])
    def story_metadata():
        return {"id": story.id, "version": story.version, "title": story.title,
                "is_test_fixture": story.is_test_fixture, "item_name": story.item_name,
                "inspection_targets": [{"id": k, "label": v.label} for k, v in story.targets.items()],
                "flow": story.flow, "source": story.source,
                "owner": story.owner, "custodian": story.custodian, "recipient": story.recipient}

    @app.post("/api/sessions", status_code=201, response_model=SessionCreated, tags=["会话"])
    def create_session():
        token, state = store.create(story)
        return SessionCreated(token=token, state=state)

    @app.get("/api/session", response_model=State, tags=["会话"])
    def session(token: Token):
        return store.get(token)

    @app.post("/api/inspect", response_model=State, tags=["游戏操作"])
    async def inspect(command: InspectCommand, token: Token):
        return await game.execute(token, "inspect", command)

    @app.post("/api/chat", response_model=State, tags=["游戏操作"])
    async def chat(command: ChatCommand, token: Token):
        return await game.execute(token, "chat", command)

    @app.post('/api/voice', tags=['游戏操作'])
    async def voice(command: VoiceRequest, token: Token):
        state = await asyncio.to_thread(store.get, token)
        game.check_story(state)
        return Response(await dialogue_audio(state, command.text), media_type='audio/mpeg')

    @app.get("/api/pages/{page_id}", response_model=Page, tags=["故事"])
    def page(page_id: str, token: Token):
        state = store.get(token)
        if (state.story_id, state.story_version) != (story.id, story.version):
            raise AppError(409, "STORY_VERSION_CHANGED", "故事配置已更换，请确认重置后开始新体验")
        if page_id not in state.unlocked_pages:
            raise AppError(403, "PAGE_LOCKED", "故事片段尚未解锁")
        return Page(**story.pages[page_id].model_dump(exclude={"requires_facts"}))

    @app.post("/api/pages/{page_id}/read", response_model=State, tags=["游戏操作"])
    async def read_page(page_id: str, command: Command, token: Token):
        return await game.execute(token, "read_page", command, page_id)

    @app.post("/api/collection", response_model=State, tags=["游戏操作"])
    async def collect(command: CollectCommand, token: Token):
        return await game.execute(token, "collect", command)

    @app.post("/api/reset", response_model=State, tags=["会话"])
    async def reset(command: ResetCommand, token: Token):
        return await game.execute(token, "reset", command)

    @app.post('/api/replay', response_model=State, tags=['会话'])
    async def replay(command: ConfirmCommand, token: Token):
        return await game.execute(token, 'replay', command)

    @app.post("/api/screening/start", response_model=State, tags=["放映"])
    async def start_screening(command: ConfirmCommand, token: Token):
        return await game.execute(token, "screening_start", command)

    @app.get("/api/screening", response_model=ScreeningView, tags=["放映"])
    def screening(token: Token):
        state = store.get(token)
        game.check_story(state)
        if story.screening is None or state.playback is None:
            raise AppError(403, "SCREENING_NOT_STARTED", "请先确认开始放映")
        # Only return the current unit, so a client cannot read unreached story text early.
        index = state.playback.next_segment
        segment = story.screening.segments[index] if index < len(story.screening.segments) else None
        return {"story_id": story.id, "story_version": story.version, "version": state.version,
                "phase": state.phase, "playback": state.playback, "segment": segment,
                "total_segments": len(story.screening.segments)}

    @app.post("/api/screening/progress", response_model=State, tags=["放映"])
    async def screening_progress(command: ScreeningProgressCommand, token: Token):
        return await game.execute(token, "screening_progress", command)

    @app.post("/api/screening/resume", response_model=State, tags=["放映"])
    async def resume_screening(command: ScreeningResumeCommand, token: Token):
        return await game.execute(token, "screening_resume", command)

    @app.get("/api/collection", response_model=Collection, tags=["收藏"])
    def collection(token: Token):
        state = store.get(token)
        if state.collection is None:
            raise AppError(404, "COLLECTION_NOT_FOUND", "当前体验尚未接收寄展")
        # The saved snapshot remains readable after the configured story changes.
        return state.collection

    return app


def __getattr__(name):
    # Keep the established app.main:app entry point without constructing an unrelated
    # environment-configured app when a custom provider imports create_app.
    if name == "app":
        global app
        app = create_app()
        return app
    raise AttributeError(name)
