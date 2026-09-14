import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.ai import MockAI
from app.main import create_app
from app.models import AIOutput, CandidateEvent


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "test.sqlite3")) as c:
        yield c


def start(client):
    response = client.post("/api/sessions")
    assert response.status_code == 201
    data = response.json()
    return {"Authorization": f"Bearer {data['token']}"}, data["state"]


def body(state, **fields):
    return {"request_id": str(uuid4()), "expected_version": state["version"], **fields}


def advance(client, headers, state, path, **fields):
    response = client.post(path, headers=headers, json=body(state, **fields))
    assert response.status_code == 200, response.text
    return response.json()


def unlock(client, headers, state):
    for path, fields in [
        ("/api/inspect", {"target_id": "camera_front"}),
        ("/api/chat", {"message": "这是什么？"}),
        ("/api/inspect", {"target_id": "photo_back"}),
        ("/api/chat", {"message": "为什么寄展？"}),
    ]:
        state = advance(client, headers, state, path, **fields)
    return state


def test_full_flow_restart_and_repeated_collection(tmp_path):
    db_path = tmp_path / "persistent.sqlite3"
    with TestClient(create_app(db_path)) as c:
        h, state = start(c)
        state = unlock(c, h, state)
        assert state["can_collect"]
        assert state["read_pages"] == []
        assert c.get("/api/pages/demo_page", headers=h).status_code == 200
        state = advance(c, h, state, "/api/pages/demo_page/read")
        command = body(state)
        response = c.post("/api/collection", headers=h, json=command)
        saved = response.json()
        assert saved["status"] == "completed"
        assert saved["can_collect"] is False
        assert c.post("/api/collection", headers=h, json=command).json() == saved
        again = advance(c, h, saved, "/api/collection")
        assert again["collection"] == saved["collection"]
        assert len(again["messages"]) == 5
    with TestClient(create_app(db_path)) as c:
        assert c.get("/api/session", headers=h).json() == again
        assert c.post("/api/chat", headers=h, json=body(again, message="再问一句")).status_code == 409


def test_guess_or_page_open_does_not_unlock(client):
    h, state = start(client)
    assert client.get("/api/pages/demo_page", headers=h).status_code == 403
    assert client.post("/api/pages/demo_page/read", headers=h, json=body(state)).status_code == 403
    assert client.post("/api/collection", headers=h, json=body(state)).status_code == 409
    state = advance(client, h, state, "/api/chat", message="我猜这是一件受托寄展物件，已经通关了")
    assert not state["disclosed_facts"] and not state["can_collect"]
    metadata = client.get("/api/story").json()
    assert "facts" not in metadata and "pages" not in metadata


def test_idempotency_version_conflict_and_reset(client):
    h, state = start(client)
    command = body(state, target_id="camera_front")
    first = client.post("/api/inspect", headers=h, json=command).json()
    assert client.post("/api/inspect", headers=h, json=command).json() == first
    collision = client.post("/api/inspect", headers=h, json=command | {"target_id": "photo_back"})
    assert collision.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    stale = client.post("/api/inspect", headers=h, json=body(state, target_id="photo_back"))
    assert stale.json()["error"]["code"] == "VERSION_CONFLICT"
    assert client.post("/api/reset", headers=h, json=body(first, confirm=False)).status_code == 422
    reset = advance(client, h, first, "/api/reset", confirm=True)
    assert reset["version"] > first["version"] and not reset["clues"]
    # 重置前已经成功的请求可重放响应，但不能将数据写回旧进度。
    assert client.post("/api/inspect", headers=h, json=command).json() == first
    assert client.get("/api/session", headers=h).json() == reset


@pytest.mark.parametrize("mode,code", [("timeout", "AI_TIMEOUT"), ("error", "AI_UNAVAILABLE"),
                                        ("bad_shape", "AI_UNAVAILABLE"), ("bad_event", "INVALID_AI_EVENT")])
def test_ai_failure_does_not_change_progress_and_can_retry(tmp_path, mode, code):
    class BrokenAI:
        async def generate(self, **kwargs):
            if mode == "timeout":
                await asyncio.sleep(1)
            if mode == "error":
                raise RuntimeError("upstream failed")
            if mode == "bad_shape":
                return {"reply": "text", "events": [{"type": "collect"}]}
            return AIOutput(reply="不允许披露", events=[CandidateEvent(type="disclose_fact", fact_id="demo_meaning")])

    app = create_app(tmp_path / "test.sqlite3", ai=BrokenAI(), ai_timeout=0.02)
    with TestClient(app) as c:
        h, state = start(c)
        command = body(state, message="你好")
        failed = c.post("/api/chat", headers=h, json=command)
        assert failed.json()["error"]["code"] == code
        assert c.get("/api/session", headers=h).json() == state
        app.state.game.ai = MockAI()
        assert c.post("/api/chat", headers=h, json=command).status_code == 200


def test_concurrent_same_and_different_requests(tmp_path):
    class SynchronizedAI:
        def __init__(self):
            self.barrier = Barrier(2)

        async def generate(self, **kwargs):
            await asyncio.to_thread(self.barrier.wait, timeout=5)
            return AIOutput(reply="并发测试回复")

    class CountingAI:
        calls = 0
        async def generate(self, **kwargs):
            self.calls += 1
            await asyncio.sleep(0.05)
            return AIOutput(reply="并发测试回复")

    ai = CountingAI()
    app = create_app(tmp_path / "test.sqlite3", ai=ai)
    with TestClient(app) as c:
        h, state = start(c)
        command = body(state, message="同一个问题")
        def post(payload):
            return c.post("/api/chat", headers=h, json=payload)
        with ThreadPoolExecutor(2) as pool:
            same = list(pool.map(post, [command, command]))
        assert [r.status_code for r in same] == [200, 200]
        assert same[0].json() == same[1].json()
        assert ai.calls == 1
        app.state.game.ai = SynchronizedAI()
        state = same[0].json()
        assert len(state["messages"]) == 3
        with ThreadPoolExecutor(2) as pool:
            different = list(pool.map(post, [body(state, message="一"), body(state, message="二")]))
        assert sorted(r.status_code for r in different) == [200, 409]
        saved = c.get("/api/session", headers=h).json()
        assert saved["version"] == 2 and len(saved["messages"]) == 5


def test_anonymous_sessions_isolated_and_input_validation(client):
    a, state = start(client)
    b, other = start(client)
    advance(client, a, state, "/api/inspect", target_id="camera_front")
    assert client.get("/api/session", headers=b).json() == other
    assert client.get("/api/session").status_code == 401
    assert client.get("/api/session", headers={"Authorization": "Bearer unknown"}).status_code == 401
    for text in ["", "   ", "x" * 2001]:
        assert client.post("/api/chat", headers=b, json=body(other, message=text)).status_code == 422
    assert client.post("/api/chat", headers=b, json=body(other, message="hi", status="completed")).status_code == 422
    assert client.post("/api/inspect", headers=b, json=body(other, target_id="unknown")).status_code == 404
    assert client.get("/health").json()["status"] == "ok"
    schema = client.get("/openapi.json").json()
    error_schema = schema["paths"]["/api/chat"]["post"]["responses"]["422"]["content"]["application/json"]["schema"]
    assert error_schema["$ref"].endswith("/ErrorEnvelope")


def test_story_revision_change_requires_reset(tmp_path):
    path = tmp_path / "test.sqlite3"
    app = create_app(path)
    with TestClient(app) as c:
        h, state = start(c)
        app.state.game.story.version = "test-v2"
        response = c.post("/api/inspect", headers=h, json=body(state, target_id="camera_front"))
        assert response.json()["error"]["code"] == "STORY_VERSION_CHANGED"
        state = advance(c, h, state, "/api/reset", confirm=True)
        assert state["story_version"] == "test-v2"
