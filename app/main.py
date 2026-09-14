import logging
import os
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.exceptions import HTTPException

from app.ai import AIProvider, MockAI
from app.errors import AppError
from app.models import ChatCommand, Command, ErrorEnvelope, InspectCommand, Page, ResetCommand, SessionCreated, State, Story
from app.service import Game
from app.store import Store

ROOT = Path(__file__).resolve().parent.parent
security = HTTPBearer(auto_error=False)
logger = logging.getLogger("story_shop")


def bearer(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)]) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer" or len(credentials.credentials) > 200:
        raise AppError(401, "AUTH_REQUIRED", "请通过 Authorization: Bearer <token> 提供会话凭据")
    return credentials.credentials


Token = Annotated[str, Depends(bearer)]


def create_app(database_path: Path | None = None, ai: AIProvider | None = None, ai_timeout: float | None = None):
    story = Story.model_validate_json(Path(os.getenv("STORY_PATH", str(ROOT / "stories/demo.json"))).read_text())
    story.validate_references()
    if os.getenv("AI_MODE", "mock") != "mock" and ai is None:
        raise ValueError("当前只实现 AI_MODE=mock；真实 AI 请实现 AIProvider 后注入")
    if ai is None and not story.is_test_fixture:
        raise ValueError("模拟 AI 只能使用明确标注 is_test_fixture=true 的测试配置")
    store = Store(database_path or Path(os.getenv("DATABASE_PATH", str(ROOT / "data/story-shop.sqlite3"))))
    timeout = ai_timeout if ai_timeout is not None else float(os.getenv("AI_TIMEOUT_SECONDS", "10"))
    if timeout <= 0:
        raise ValueError("AI_TIMEOUT_SECONDS 必须大于 0")
    game = Game(store, story, ai or MockAI(), timeout)

    @asynccontextmanager
    async def lifespan(app):
        store.initialize()
        logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
        yield

    app = FastAPI(
        title="故事旧货铺 · 后端联调 API", version="0.1.0", lifespan=lifespan,
        description="当前为模拟 AI 和测试剧情。先创建会话，将 token 填入 Authorize。写操作携带 UUID request_id 与当前 expected_version。",
        responses={code: {"model": ErrorEnvelope} for code in (401, 403, 404, 409, 422, 500, 502, 503, 504)},
    )
    app.state.game = game
    origins = [v.strip() for v in os.getenv("CORS_ORIGINS", "").split(",") if v.strip()]
    if "*" in origins:
        raise ValueError("CORS_ORIGINS 请填写具体前端来源")
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                       allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"],
                       expose_headers=["X-Request-ID"])

    @app.middleware("http")
    async def logging_middleware(request: Request, call_next):
        request.state.trace_id = str(uuid4())
        started = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.trace_id
        response.headers["Cache-Control"] = "no-store"
        logger.info("request method=%s path=%s status=%s duration_ms=%.1f trace_id=%s",
                    request.method, request.url.path, response.status_code,
                    (time.monotonic() - started) * 1000, request.state.trace_id)
        return response

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
        logger.error("database_failed type=%s", type(exc).__name__)
        return error_response(request, 503, "DATABASE_UNAVAILABLE", "存储暂不可用，请稍后使用原 request_id 重试")

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        logger.error("unexpected_error type=%s", type(exc).__name__)
        return error_response(request, 500, "INTERNAL_ERROR", "服务异常，请使用 trace_id 排查")

    @app.get("/", include_in_schema=False)
    async def index():
        return RedirectResponse("/docs")

    @app.get("/health", tags=["系统"])
    def health():
        store.health()
        return {"status": "ok", "ai_mode": "mock" if isinstance(game.ai, MockAI) else "custom", "is_test_fixture": story.is_test_fixture}

    @app.get("/api/story", tags=["故事"])
    def story_metadata():
        return {"id": story.id, "version": story.version, "title": story.title,
                "is_test_fixture": story.is_test_fixture, "item_name": story.item_name,
                "inspection_targets": [{"id": k, "label": v.label} for k, v in story.targets.items()]}

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
    async def collect(command: Command, token: Token):
        return await game.execute(token, "collect", command)

    @app.post("/api/reset", response_model=State, tags=["会话"])
    async def reset(command: ResetCommand, token: Token):
        return await game.execute(token, "reset", command)

    return app


app = create_app()
