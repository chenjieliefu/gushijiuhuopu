"""Single-instance operational limits; all values are explicit and bounded."""
from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Limits:
    max_request_bytes: int = 16384
    requests_per_minute: int = 120
    sessions_per_hour: int = 10
    chats_per_minute: int = 30
    max_sessions: int = 1000
    session_ttl_seconds: int = 30 * 86400
    max_commands_per_session: int = 1000
    max_database_bytes: int = 512 * 1024 * 1024
    ai_daily_calls: int = 200
    cleanup_interval_seconds: int = 3600

    @classmethod
    def from_env(cls):
        names = {
            'max_request_bytes':'MAX_REQUEST_BYTES', 'requests_per_minute':'REQUESTS_PER_MINUTE',
            'sessions_per_hour':'SESSION_CREATES_PER_HOUR', 'chats_per_minute':'CHATS_PER_MINUTE',
            'max_sessions':'MAX_SESSIONS', 'session_ttl_seconds':'SESSION_TTL_SECONDS',
            'max_commands_per_session':'MAX_COMMANDS_PER_SESSION', 'max_database_bytes':'MAX_DATABASE_BYTES',
            'ai_daily_calls':'AI_DAILY_CALL_LIMIT', 'cleanup_interval_seconds':'CLEANUP_INTERVAL_SECONDS',
        }
        defaults = cls()
        values = {field:int(os.getenv(env, str(getattr(defaults, field)))) for field,env in names.items()}
        if any(value <= 0 for value in values.values()):
            raise ValueError('运行限额必须全部为正整数')
        return cls(**values)
