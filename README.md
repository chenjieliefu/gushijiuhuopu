# 故事旧货铺

前端、AI 与后端接入统一对照 [正式章节联调契约 v1](docs/integration-contract.md)，字段结构见 [OpenAPI 快照](docs/contracts/openapi.json)。

运行限额、AI 日调用预算、过期清理、备份恢复和部署预检见 [后端运行保障](docs/backend-operations.md)。

![故事旧货铺](./story-poster.png)

每一件旧物，都藏着一段未完的故事。

在这家特别的旧货铺里，你将检查旧物、与看山自由交谈，逐步发现物件背后的人与经历。

用静态插图与文字展开故事，让旧物入店，让故事入册。

## 本轮新增：正式章节后端

已新增《遗失的晴天》v4 的连续放映配置与后端接口，支持字幕顺序确认、中断恢复、放映后交流、独立寄展确认和收藏内容快照。详见 [正式章节后端与接入准备](docs/formal-chapter.md)。

```bash
STORY_PATH=stories/lost-sunshine.json AI_MODE=scripted \
  uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

这条命令使用固定问答联调器，**没有接入真实模型**。51 段字幕来自仓库脚本，原文 43 段分段尚未核实，素材映射待确认。现有前端连续播放器尚未接入新协议，默认 demo 继续服务旧前端联调；正式后端可通过 `/docs` 和 `scripts/smoke_screening.py` 验收。

## 后端联调服务

后端采用 Python 3.11+、FastAPI 和 SQLite，支持匿名会话、模拟聊天、检查线索、测试故事页、收藏、重置与进度恢复。当前用于团队联调，接口和正式剧情规则仍需共同确认。

**这是接口联调版本。AI 是固定逻辑，`stories/demo.json` 是测试剧情，均不代表《遗失的晴天》的正式内容和条件。没有接入真实模型，也没有发布公网服务。**

## 启动

启动前需安装 Python 3.11+ 和 uv。依赖完整锁定在 `uv.lock`：

```bash
uv sync --locked
cp .env.example .env
uv run --env-file .env uvicorn app.main:app --host 127.0.0.1 --port 8000
```

也可以使用 Python 3.11+ 的虚拟环境安装 `requirements.txt` 后运行 `python -m uvicorn app.main:app`。开发热更新时增加 `--reload`，部署时不要启用。

- 接口文档：<http://127.0.0.1:8000/docs>
- 接口契约：<http://127.0.0.1:8000/openapi.json>
- 健康检查：<http://127.0.0.1:8000/health>，实际检查数据库连接。

启动时自动建表。数据库默认位于 `data/story-shop.sqlite3`，重启服务不会清空数据。`.env` 需通过上面的 `--env-file` 显式加载。

## 不等前端就可以验收

保持服务运行，在另一终端执行：

```bash
uv run python scripts/smoke.py
```

脚本会创建独立测试会话，完成检查、问答、故事页、收藏、重复请求和读回验证；不会打印会话凭据。

自动化测试：

```bash
uv run pytest -q
```

包括完整流程、换应用实例恢复、并发同一请求去重、并发不同请求冲突、重复收藏、错误猜测、非法 AI 事件、AI 超时和失败后重试、重置与会话隔离。

## 在 Swagger 中手动体验

1. 执行 `POST /api/sessions`，复制响应中的 `token`。这是匿名会话凭据，不是模型 API Key。
2. 点击页面右上的 **Authorize**，填入 token 本身。
3. 每个写请求使用新的 UUID `request_id`，`expected_version` 填上一响应的 `version`（初始为 0）。可用 `python -c 'import uuid; print(uuid.uuid4())'` 生成 UUID。
4. `POST /api/inspect`，`target_id` 为 `camera_front`。
5. `POST /api/chat`，输入任意非空文字；模拟 AI 披露测试事实 A。
6. 检查 `photo_back`，再聊天一次，披露测试事实 B，解锁 `demo_page`。
7. 获取 `GET /api/pages/demo_page`；阅读后调用 `POST /api/pages/demo_page/read`。读取与标记阅读分开。
8. `POST /api/collection` 完成寄展。`GET /api/session` 可以回顾收藏。
9. `POST /api/reset`，增加 `confirm: true`，开始新体验。版本号继续增长，防止重置前的在途请求覆盖新进度。

模拟 AI 不理解问题含义：它只在检查条件满足后按测试配置披露一个事实。请不要把这条测试路径当作正式问答设计。

## 前端与 AI 交接

见 [接口约定与样例](docs/api.md) 和 [部署与恢复](docs/deployment.md)。三份对接文档：

- [陈家庆：故事配置与规则](docs/01-与陈家庆沟通-故事配置与规则.md)
- [宋浩然：AI 模块接入](docs/02-与宋浩然沟通-AI模块与后端接入.md)
- [王泽轩：前端接口与联调](docs/03-与王泽轩沟通-前端接口与联调.md)

核心代码：

| 文件 | 作用 |
| --- | --- |
| `app/main.py` | API、认证、CORS、错误返回与请求日志 |
| `app/service.py` | 游戏操作、候选事件校验、解锁和收藏条件 |
| `app/store.py` | SQLite 持久化、版本控制、幂等记录 |
| `app/ai.py` | AIProvider 接口和可替换的模拟实现 |
| `app/models.py` | 请求、响应、故事配置和 AI 返回的数据结构 |
| `stories/demo.json` | 明确标注的测试配置 |

产品负责人需要提供正式故事配置和披露规则；宋浩然需要对齐 `AIProvider`；王泽轩可以先按 `/docs` 和模拟接口开发。修改剧情语义或条件时必须更换 `version`。旧会话可以查看已存进度，但需确认重置才能使用新配置继续。

## 当前边界

- 一个配置版本、单实例、小规模联调；没有账户系统、跨设备同步或真实 AI；已加入单实例限流与过期清理，多实例和公网入口治理待部署时验证。
- 每个会话最多 100 轮问答；聊天上下文保留在消息列表中，摘要目前只记录已校验的事实，不是完整的语义记忆。
- Bearer token 由前端在同一浏览器保存，丢失后不能恢复该会话；后端只保存 token 的哈希。不要把 token 放在 URL、日志或共享文档中。
- SQLite 和幂等记录一起持久化。命令状态更新与去重记录在同一事务完成；同进程内同一请求的并发 AI 调用已合并，最多提交一次状态。进程崩溃和多进程部署仍需供应商幂等与费用预算。
- 后端筛选当前允许的模型材料并校验结构化事件和前置条件，**不能据此证明任意模型生成的自然语言没有提前泄露事实**。真实 AI 接入前，需要与 AI 同学实现允许内容过滤、台词与披露事件一致性检查，并做剧情测试。
- 当前测试剧情把事实披露放在已保存的角色回复中，读故事页不新增事实。正式章节已经通过独立的放映进度接口记录完整展示确认，`read` 仍不作为剧情披露。
- 服务保存回复表示已生成并可恢复，无法证明玩家已经看到网络响应；如正式验收要求严格的展示确认，需要前后端另行约定确认事件。

实现中的测试生命周期和 TestClient 用法参考 [FastAPI 测试文档](https://fastapi.tiangolo.com/tutorial/testing/) 与 [lifespan 文档](https://fastapi.tiangolo.com/advanced/events/)。

## 前端交互样例（王泽轩）

前端在 `frontend/`，可以独立体验第一章的页面与交互。当前使用明确标识的本地样例回应和 SVG 占位素材；已通过本地后端测试章节的实际 HTTP 联调；真实 AI、共享环境、正式放映播放器接入与美术验收待后续对接。

```bash
cd frontend
npm ci
npm run dev
```

打开 http://127.0.0.1:5178 。同一浏览器可继续上次进度；页面底部提供确认重置和一次性故障模拟。

```bash
npm run build
npm test
npx playwright install chromium --only-shell
npm run test:e2e
```

- [前端交付、布局与接口缺口](docs/frontend-handoff.md)
- [给美术的素材需求与替换约定](docs/art-assets.md)
- [验证范围与结果](docs/frontend-validation.md)

后续联调可参考 `frontend/.env.example` 切换 HTTP 适配器。HTTP 适配器已通过本地 FastAPI 测试章节的桌面/手机实际联调，详见 [本地联调与验证](docs/local-integration.md)。这不代表正式 AI 或公网环境已经就绪。
