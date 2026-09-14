# 前端 / AI 接口约定草案

本文件保留探索 demo 的接口说明。新增的正式章节三阶段、放映进度与接收确认协议见 [正式章节后端](formal-chapter.md)。运行后以 `/openapi.json` 中的字段类型为准。

## 会话与响应

`POST /api/sessions` 无需登录，返回 `201`：

```json
{
  "token": "仅创建时返回的匿名会话凭据",
  "state": {
    "session_id": "UUID",
    "story_id": "integration-demo",
    "story_version": "test-v1",
    "is_test_fixture": true,
    "version": 0,
    "status": "active",
    "clues": [],
    "disclosed_facts": [],
    "unlocked_pages": [],
    "read_pages": [],
    "messages": [{"role": "assistant", "text": "测试开场白"}],
    "summary": "",
    "expression": "neutral",
    "suggested_questions": [],
    "can_collect": false,
    "collection": null
  }
}
```

除健康检查、公开故事元数据和创建会话外，全部 API 需要：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

前端保存 token 后，每次刷新先调用 `GET /api/session`。`401` 表示缺失或无效凭据；不要在网络错误或 `5xx` 时自动创建新会话，以免看起来丢失进度。创建会话本身每次都会生成一个新会话，不具有命令去重语义；首个创建响应丢失时可重新创建。

所有成功的游戏写操作直接返回完整 `State`，不会再套 `state`。前端统一使用服务端返回的状态。

## 路由

| 方法与路径 | 额外请求字段 | 作用 |
| --- | --- | --- |
| `GET /health` | 无 | 服务与存储健康检查 |
| `GET /api/story` | 无 | 公开标题、物件名、可检查位置，不含未披露内容 |
| `POST /api/sessions` | 无 | 创建新匿名会话 |
| `GET /api/session` | 无 | 读取完整进度、对话、收藏 |
| `POST /api/inspect` | `target_id` | 记录物件线索 |
| `POST /api/chat` | `message`（1–2000 字符） | 获取回复并校验保存候选事件 |
| `GET /api/pages/{page_id}` | 无 | 读取已解锁的固定故事文字 |
| `POST /api/pages/{page_id}/read` | 无 | 标记阅读，不改变事实披露 |
| `POST /api/collection` | 无 | 核心事实满足后接收寄展 |
| `POST /api/reset` | `confirm: true` | 清空当前体验内容并递增版本 |

所有游戏写操作（创建会话除外）必须包含：

```json
{
  "request_id": "f2a5cd43-479e-41a4-badf-64c2b39c353a",
  "expected_version": 0,
  "target_id": "camera_front"
}
```

这是 `/api/inspect` 样例。`chat` 将 `target_id` 换为 `message`，其余操作按表填写。

## 重试、并发与前端状态

- 一次用户操作生成一个 `request_id`；断网重试必须复用整个原始请求，包括 `expected_version`。
- 同一会话、同一 `request_id`、相同内容返回第一次成功提交的完整响应；更换内容返回 `409 IDEMPOTENCY_CONFLICT`。
- 不同请求同时基于同一版本修改时，最多一个提交成功，其余返回 `409 VERSION_CONFLICT`。重新 GET 状态，根据用户仍然需要的动作生成新请求。
- 旧请求的幂等重放会返回旧版本快照。前端只应用 `version >= 当前本地版本` 的响应；遇到旧版本则 GET 最新状态。重置不重用版本号。
- AI 超时、无效结果和校验失败不保存玩家消息，也不推进状态；前端应保留输入和原始请求以供重试。
- 同一 UI 会话一次只发送一个游戏写操作；响应期间显示等待状态。这减少版本冲突，但服务端仍会处理并发。
- 通过比较前后 `unlocked_pages` 计算新故事页提示；不能每次收到同一个响应都自动弹窗。
- `status=completed` 时停止新检查和聊天；可以回顾页面、收藏、确认重置。跳过物件入架动画不会改变已经保存的收藏。
- `reset` 清空当前会话的对话、线索和收藏，但保留操作去重快照以处理在途重试；它不是隐私数据删除接口。

错误统一格式：

```json
{"error":{"code":"VERSION_CONFLICT","message":"进度已更新，请重新读取后再操作","trace_id":"服务端请求追踪 UUID"}}
```

常用错误：`401 AUTH_REQUIRED/INVALID_SESSION`、`403 PAGE_LOCKED`、`404 TARGET_NOT_FOUND`、`409 COLLECTION_LOCKED/SESSION_COMPLETED/STORY_VERSION_CHANGED/TURN_LIMIT`、`422 INVALID_REQUEST`、`502 AI_UNAVAILABLE/INVALID_AI_EVENT`、`504 AI_TIMEOUT`、`503 DATABASE_UNAVAILABLE`。日志只记录方法、路径、状态、耗时和追踪 ID，不记录凭据或聊天正文。

## 宋浩然的 AI 模块接入点

实现 `app/ai.py` 中的 `AIProvider.generate`：

```python
async def generate(*, message: str, state: State, story: Story) -> AIOutput:
    ...
```

返回示例（仅在 `camera_front` 已检查时合法）：

```json
{
  "reply": "测试事实 A：这是一件受托送来的寄展物件。",
  "expression": "warm",
  "suggested_questions": ["还有什么可以了解的？"],
  "events": [{"type": "disclose_fact", "fact_id": "demo_origin"}]
}
```

AI 模块收到会话副本与已筛选的配置投影（只包含当前允许的材料，不是可重新加载的完整 Story）。模块负责保持看山身份，并确认回复确实呈现了所声明的事实；禁止重新加载完整故事绕过筛选。

后端验证输出 schema、事实 ID 和线索/事实前置条件，之后统一保存消息和状态。它不接受 `collect` 或 `unlock_page` 等由模型直接决策的事件；解锁由规则计算，收藏由玩家确认触发。

适配器应使用异步网络客户端并设置客户端超时；外层 `asyncio.wait_for` 无法中断阻塞事件循环的同步 SDK。使用 `create_app(ai=YourProvider())` 注入。`AI_MODE` 现支持 `mock`、`scripted` 和通过可信本地工厂加载的 `custom`，配置错误或真实模型失败都不会静默降级。

真实 AI 的词义理解、未知细节回应、提示词、完整交流摘要和语义事实一致性目前均未实现；需要真实模块与产品测试样例共同验收。
