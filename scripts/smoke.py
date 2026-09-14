"""通过真实 HTTP 走完测试章节，不依赖前端。"""
import argparse
import json
from urllib.request import Request, urlopen
from uuid import uuid4


def run(base_url):
    def call(path, body=None, token=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = Request(base_url.rstrip("/") + path, headers=headers,
                      data=json.dumps(body).encode() if body is not None else None)
        with urlopen(req, timeout=15) as response:
            return json.load(response)

    assert call("/health")["status"] == "ok"
    created = call("/api/sessions", {})
    token, state = created["token"], created["state"]
    assert state["is_test_fixture"]
    for path, fields in [
        ("/api/inspect", {"target_id": "camera_front"}),
        ("/api/chat", {"message": "这是什么物件？"}),
        ("/api/inspect", {"target_id": "photo_back"}),
        ("/api/chat", {"message": "为什么要寄展？"}),
        ("/api/pages/demo_page/read", {}),
        ("/api/collection", {}),
    ]:
        body = {"request_id": str(uuid4()), "expected_version": state["version"], **fields}
        state = call(path, body, token)
        assert call(path, body, token) == state, "相同请求重试应返回同一结果"
    assert state["status"] == "completed"
    assert call("/api/session", token=token) == state
    print(json.dumps({"result": "passed", "version": state["version"], "status": state["status"],
                      "collection": state["collection"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    run(parser.parse_args().base_url)
