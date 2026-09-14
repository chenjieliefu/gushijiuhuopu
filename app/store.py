import hashlib
import json
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from app.errors import AppError
from app.models import Message, State, Story


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def fresh_state(session_id: str, story: Story, version: int = 0) -> State:
    return State(
        session_id=session_id, story_id=story.id, story_version=story.version,
        is_test_fixture=story.is_test_fixture, version=version,
        messages=[Message(role="assistant", text=story.opening)],
    )


class Store:
    def __init__(self, path: Path):
        self.path = path

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    token_hash TEXT UNIQUE NOT NULL,
                    version INTEGER NOT NULL,
                    state_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS requests (
                    session_id TEXT NOT NULL,
                    request_id TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    response_json TEXT NOT NULL,
                    PRIMARY KEY (session_id, request_id)
                );
            """)

    def health(self):
        with self.connection() as db:
            db.execute("SELECT id FROM sessions LIMIT 1").fetchone()

    def create(self, story: Story):
        token = secrets.token_urlsafe(32)
        state = fresh_state(str(uuid4()), story)
        with self.connection() as db, db:
            db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)",
                       (state.session_id, token_hash(token), state.version, state.model_dump_json()))
        return token, state

    def get(self, token: str) -> State:
        with self.connection() as db:
            row = db.execute("SELECT state_json FROM sessions WHERE token_hash = ?", (token_hash(token),)).fetchone()
        if row is None:
            raise AppError(401, "INVALID_SESSION", "会话无效，请开始新的体验")
        return State.model_validate_json(row["state_json"])

    @staticmethod
    def fingerprint(operation: str, payload: dict) -> str:
        return hashlib.sha256(json.dumps([operation, payload], sort_keys=True).encode()).hexdigest()

    @staticmethod
    def _replay(db, session_id: str, request_id: str, fingerprint: str):
        row = db.execute("SELECT * FROM requests WHERE session_id = ? AND request_id = ?",
                         (session_id, request_id)).fetchone()
        if row is None:
            return None
        if row["fingerprint"] != fingerprint:
            raise AppError(409, "IDEMPOTENCY_CONFLICT", "同一 request_id 不能用于不同请求")
        return State.model_validate_json(row["response_json"])

    def replay(self, session_id: str, request_id: str, fingerprint: str):
        with self.connection() as db:
            return self._replay(db, session_id, request_id, fingerprint)

    def commit(self, state: State, expected_version: int, request_id: str, fingerprint: str):
        # AI 调用发生在事务外；提交时再次核对版本，避免慢回复覆盖其他操作。
        with self.connection() as db, db:
            db.execute("BEGIN IMMEDIATE")
            previous = self._replay(db, state.session_id, request_id, fingerprint)
            if previous is not None:
                return previous
            state.version = expected_version + 1
            serialized = state.model_dump_json()
            updated = db.execute(
                "UPDATE sessions SET version = ?, state_json = ? WHERE id = ? AND version = ?",
                (state.version, serialized, state.session_id, expected_version),
            )
            if updated.rowcount != 1:
                raise AppError(409, "VERSION_CONFLICT", "进度已更新，请重新读取后再操作")
            db.execute("INSERT INTO requests VALUES (?, ?, ?, ?)",
                       (state.session_id, request_id, fingerprint, serialized))
        return state
