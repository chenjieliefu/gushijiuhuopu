# 正式章节后端与接入准备

运行限额、AI 日调用预算、过期清理、备份恢复和部署预检见 [后端运行保障](backend-operations.md)。

本次以 `materials/遗失的晴天/遗失的晴天_Galgame逐句对话与画面脚本.md` v4 为流程依据。新增 `stories/lost-sunshine.json`，保留 demo 供旧前端联调使用。

已提供后端阶段、逐单元进度、恢复、寄展确认、收藏快照和自定义 AI 模块入口。前端连续播放器与素材映射提案已交付并完成本地 HTTP 联调，见 [前端交接](frontend-screening-handoff.md)。真实 AI、最终素材审定和共享部署仍待完成；不能把本地测试通过当作游戏已上线。

## 内容与素材状态

- 51 个 FILM 单元逐字取自仓库脚本，初排总时长 317 秒。测试核对字幕、顺序及时间轴。
- 脚本引用的完整原文 `.txt` 尚未找到。`source.text_format=screening_units`，`source.original_verified=false`；收藏保留全部 51 单元，不伪造原文的 43 段分段。
- 所有人为苏晚、寄展办理人为看山、接收方为本店；受托寄展单独标记为游戏新增设定。
- 原作者、正式原文链接和授权记录待核实，配置不填猜测值。
- 每段有原脚本的 `visual` 分镜说明；`asset_id=null`，不根据图片文件名猜测最终镜头。素材负责人确认后，把引用写入 `assets` 和字幕 `asset_id`。
- 内容、条件、时间轴或素材引用变化必须提高 `Story.version`。旧会话保留已保存内容，继续新版本需确认重置。

## 本地启动

```bash
uv sync --locked
STORY_PATH=stories/lost-sunshine.json AI_MODE=scripted \
  uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

也可使用 `uvicorn app.main:create_app --factory`。`/health` 返回 `flow=screening`、`ai_mode=scripted`、`original_verified=false`。scripted 是固定问答联调器，未匹配问题会明确提示自由问答未接入，不能作为真实模型验收。

新版前端已支持此放映协议，在 frontend 运行 `npm run dev:screening` 可连接正式配置。旧探索样例继续使用 demo。前端需显示当前 AI 模式与素材/原文待核对状态，避免把联调内容当作已完成的正式体验。

## 阶段与接口

所有写请求都需要 Bearer token、UUID `request_id` 和最新 `expected_version`。重复请求原样重试，不更换 ID 或版本。成功返回完整 State。新接口继续使用同一事务、幂等记录和版本校验。

| 阶段 | 允许操作 | 进入下一阶段 |
| --- | --- | --- |
| `before_screening` | 交流、检查、明确开始、重置 | `POST /api/screening/start` + `confirm:true` |
| `screening` | 获取当前字幕、确认当前字幕完成、恢复；显式重置保留为管理恢复能力 | 全部 51 单元按顺序确认 |
| `after_screening` | 交流、检查、明确接收、重置 | `POST /api/collection` + `confirm:true` |
| `completed` | 读取收藏、重复接收、重置 | 重置回到开场 |

放映中拒绝聊天、检查、收藏，不排队生成回复。前端正常放映界面不得提供交互控件，包括重置；后端保留显式重置用于中断后的恢复界面。`status` 仍为 `active/completed`，新前端应使用 `phase` 区分播放阶段。旧探索 demo 使用 `phase=exploration`。

新增接口：

| 路径 | 额外字段 / 返回 |
| --- | --- |
| `POST /api/screening/start` | `confirm:true`；创建播放 `run_id`，保存开始台词 |
| `GET /api/screening` | 当前字幕 `segment`、`playback`、`phase`、`version`、`story_version`、`total_segments`；无写入副作用 |
| `POST /api/screening/progress` | `run_id`、`segment_id`；只能确认当前单元 |
| `POST /api/screening/resume` | 当前 `run_id`；位置不前进，签发新 `run_id` 并重新计时 |
| `GET /api/collection` | 已接收内容的版本快照，换剧情版本后仍可读取 |

`playback.next_segment` 是 **0 起始的下一个未确认完成单元**；`segment_started_at` 是服务端 Unix 秒。只有最后单元成功确认后才设置 `playback.completed=true`，进入 `after_screening` 并记录已放映事实。打开字幕、开始加载、聊天猜中或单纯等待均不会自动写入完成。

### 播放器接入顺序

1. 创建或恢复会话，核对 `story_id/story_version` 与 `/api/story` 相同；若发生版本变化，更新元数据再渲染检查点。
2. 玩家明确选择听故事后发送 start；自由输入表达开始意图也必须经过前端明确的开始动作，模型事件不能启动或完成放映。
3. GET 当前字幕，预加载对应素材并展示。只有当前字幕可获取，不能在开场批量读取后续正文。
4. 当前单元完整显示到时长后自动发送 progress。网络往返期间保留当前画面；失败保留原请求，按原 ID 重试，不先显示下一段。
5. 服务器成功确认后获取下一单元；最后一段成功确认后才回到柜台交流。最短时长是服务端下限，前端仍须保证素材加载后实际完整展示。
6. 中途刷新时先恢复 State，处理未决请求，再发送 resume，从尚未确认完成的单元重新播放。旧播放器的 `run_id` 不再有效。
7. 寄展确认卡取消无需写入；点击确认才发送 `collection` 的 `confirm:true`，成功后播放入架与告别动效。

服务端只能核实收到的确认顺序和最短时间，无法证明用户实际注视了屏幕，也无法辨别客户端伪造的观看报告。此协议用于正确客户端的恢复和防误推进，不应当宣称是强防作弊证明。

同一会话多标签页或在途 AI 竞争时，最多一个版本提交成功；失败者重新读 State。迟到回复不能覆盖已经开始放映或重置后的状态。读取旧幂等响应时，前端仍只接受不低于本地版本的快照。

`reset` 清空本次体验、播放和收藏，版本继续递增；它不是历史隐私数据删除接口。确认卡上的“再想一想”不能调用 reset。

## AI 接入约定

已有 `AIProvider.generate(*, message, state, story)` 兼容入口。设置：

```text
AI_MODE=custom
AI_PROVIDER_FACTORY=app.your_provider:create_provider
AI_TIMEOUT_SECONDS=10
AI_MAX_PARALLEL=4
```

工厂来自可信本地模块，零参数返回实现异步 `generate` 的对象。也可在专用入口调用 `create_app(ai=provider, story_path=...)`。配置错误启动失败，不静默回退到 mock/scripted。模块不得在 import 时启动服务；供应商密钥由其约定环境变量注入。

后端先筛选允许内容，再调用 provider：

- 放映前删除隐藏事实、完整正文、时间轴、放映后问答、收藏概要和未检查物件的文字。
- 放映中完全不调用 AI。
- 放映后可使用全部本版字幕和配置问答，原文未知事项仍保持未知。
- `story` 是经过筛选的上下文投影，不是可重新运行的完整 Story 配置；不得对其调用 `validate_references()` 或重新从文件加载完整故事绕过筛选。
- 模型不能披露尚未完成放映的正式故事事实，也不能决定开始放映、完成放映或寄展。旧探索 demo 保留已允许的事实候选事件。
- `reply` 1–2000 字符，建议问题最多 3 个、每个 1–200 字符。空白、未知字段、无效事件均不保存。

输入过滤和事件校验不等于自然语言语义校验。真实适配器仍需检查台词和建议问题是否泄露、是否与事实一致，并通过换问法、诱导剧透、身份混淆和未知病名等验收；本轮没有真实模型可验证。

同进程、同会话、同 request_id 的并发聊天现在合并调用，断开一个等待者不会取消其他等待者。默认最多 4 个在途聊天请求，超出返回 `429 AI_BUSY`。这是单实例并发保护，不能替代供应商计费幂等、跨进程调用合并、每日预算或公网限流；进程崩溃后重试仍可能再次付费。现有问答上限保留为 100 个用户消息（开始放映的确认台词计入一条）。

## 验证

```bash
uv run --locked pytest -q
# 保持正式章节测试服务运行，耗时约 5 分 17 秒加网络开销：
uv run python scripts/smoke_screening.py
# 默认 demo 服务仍用：
uv run python scripts/smoke.py
```

自动化测试覆盖字幕一致性、完整流程、进程实例间恢复、恢复后旧 run_id、过早/跳序确认、放映期间输入、AI 伪造事件、迟到回复、收藏独立确认、内容版本快照、重置和旧幂等数据兼容，以及 SQLite 锁等待和异常 CORS。CI 使用锁文件运行后端测试。

真实 HTTP 脚本创建独立匿名会话，不打印凭据；请仅指向隔离测试数据库。容器参数已支持 STORY_PATH / AI_MODE / AI_PROVIDER_FACTORY / AI_MAX_PARALLEL，但本轮没有配置真实供应商或发布共享服务。
