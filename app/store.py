import hashlib
import json
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from app.errors import AppError
from app.limits import Limits
from app.models import Message, State, Story
from app.rules import refresh_rules


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def fresh_state(session_id: str, story: Story, version: int = 0) -> State:
    state = State(
        session_id=session_id, story_id=story.id, story_version=story.version,
        is_test_fixture=story.is_test_fixture, version=version,
        messages=[Message(role="assistant", text=story.opening)],
        phase="before_screening" if story.flow == "screening" else "exploration",
    )
    refresh_rules(state, story)
    return state


class Store:
    def __init__(self, path: Path, limits: Limits | None = None, clock=time.time):
        self.path = path
        self.limits = limits or Limits()
        self.clock = clock

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
                CREATE TABLE IF NOT EXISTS session_activity (
                    session_id TEXT PRIMARY KEY,
                    last_seen REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS session_activity_last_seen ON session_activity(last_seen);
                CREATE TABLE IF NOT EXISTS ai_daily_usage (
                    day TEXT PRIMARY KEY,
                    attempts INTEGER NOT NULL
                );
            """)
            # Released databases have no activity timestamps. Give existing sessions
            # one retention period from upgrade rather than guessing their creation time.
            with db:
                db.execute("INSERT OR IGNORE INTO session_activity SELECT id, ? FROM sessions", (self.clock(),))

    def check_storage(self):
        total = self.path.stat().st_size
        try:
            total += Path(str(self.path) + '-wal').stat().st_size
        except FileNotFoundError:
            pass  # SQLite removes WAL when its last connection closes.
        if total >= self.limits.max_database_bytes:
            raise AppError(503, "STORAGE_QUOTA", "存储已达配额，请管理员清理并回收空间")

    def check_command_capacity(self, session_id):
        self.check_storage()
        with self.connection() as db:
            count = db.execute("SELECT COUNT(*) FROM requests WHERE session_id=?", (session_id,)).fetchone()[0]
            if count >= self.limits.max_commands_per_session:
                raise AppError(409, "SESSION_COMMAND_LIMIT", "当前会话操作记录已达上限，请新建会话")

    def reserve_ai_call(self):
        day = datetime.fromtimestamp(self.clock(), timezone.utc).date().isoformat()
        with self.connection() as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT attempts FROM ai_daily_usage WHERE day=?", (day,)).fetchone()
            attempts = row[0] if row else 0
            if attempts >= self.limits.ai_daily_calls:
                raise AppError(429, "AI_DAILY_LIMIT", "今日回复调用预算已用完，请稍后再试")
            db.execute("INSERT INTO ai_daily_usage VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET attempts=attempts+1", (day,))

    def cleanup(self, *, dry_run: bool = True):
        cutoff = self.clock() - self.limits.session_ttl_seconds
        with self.connection() as db, db:
            db.execute("BEGIN IMMEDIATE")
            count = db.execute("SELECT COUNT(*) FROM session_activity WHERE last_seen < ?", (cutoff,)).fetchone()[0]
            if not dry_run:
                db.execute("DELETE FROM requests WHERE session_id IN (SELECT session_id FROM session_activity WHERE last_seen < ?)", (cutoff,))
                db.execute("DELETE FROM sessions WHERE id IN (SELECT session_id FROM session_activity WHERE last_seen < ?)", (cutoff,))
                db.execute("DELETE FROM session_activity WHERE last_seen < ?", (cutoff,))
                day = datetime.fromtimestamp(cutoff, timezone.utc).date().isoformat()
                db.execute("DELETE FROM ai_daily_usage WHERE day < ?", (day,))
        return {"expired_sessions":count,"dry_run":dry_run}

    def health(self):
        with self.connection() as db:
            db.execute("SELECT id FROM sessions LIMIT 1").fetchone()

    def create(self, story: Story):
        token = secrets.token_urlsafe(32)
        state = fresh_state(str(uuid4()), story)
        self.check_storage()
        with self.connection() as db, db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] >= self.limits.max_sessions:
                raise AppError(503, "SESSION_CAPACITY", "会话容量已满，请管理员清理过期会话")
            db.execute("INSERT INTO session_activity VALUES (?, ?)", (state.session_id, self.clock()))
            db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)",
                       (state.session_id, token_hash(token), state.version, state.model_dump_json()))
        return token, state

    def get(self, token: str) -> State:
        with self.connection() as db, db:
            # Serialize validity checking and renewal with expiry deletion. All callers
            # run this in worker threads; the short lock does not block the event loop.
            db.execute("BEGIN IMMEDIATE")
            now = self.clock()
            row = db.execute(
                "SELECT s.id, s.state_json, a.last_seen FROM sessions s JOIN session_activity a ON a.session_id=s.id WHERE s.token_hash=?",
                (token_hash(token),),
            ).fetchone()
            if row is None or row["last_seen"] < now - self.limits.session_ttl_seconds:
                raise AppError(401, "INVALID_SESSION", "会话无效或已过期，请开始新的体验")
            # Coalesce timestamp writes so read polling does not continually grow WAL.
            if now - row["last_seen"] >= min(60, self.limits.session_ttl_seconds / 2):
                db.execute("UPDATE session_activity SET last_seen=MAX(last_seen, ?) WHERE session_id=?", (now, row["id"]))
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
            self.check_storage()
            if db.execute("SELECT COUNT(*) FROM requests WHERE session_id=?", (state.session_id,)).fetchone()[0] >= self.limits.max_commands_per_session:
                raise AppError(409, "SESSION_COMMAND_LIMIT", "当前会话操作记录已达上限，请新建会话")
            state.version = expected_version + 1
            serialized = state.model_dump_json()
            updated = db.execute(
                "UPDATE sessions SET version = ?, state_json = ? WHERE id = ? AND version = ?",
                (state.version, serialized, state.session_id, expected_version),
            )
            if updated.rowcount != 1:
                raise AppError(409, "VERSION_CONFLICT", "进度已更新，请重新读取后再操作")
            db.execute("UPDATE session_activity SET last_seen=MAX(last_seen, ?) WHERE session_id=?", (self.clock(), state.session_id))
            db.execute("INSERT INTO requests VALUES (?, ?, ?, ?)",
                       (state.session_id, request_id, fingerprint, serialized))
        return state
