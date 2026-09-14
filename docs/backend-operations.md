# 刘文浩：运行保障与交接

这份说明覆盖后端可独立完成的运行保护、备份恢复、部署检查。真实 AI 模块、服务器/域名和新版前端播放器还未提供，当前不存在已发布的共享试玩地址。

## 已实现的保护

| 配置 | 默认值 | 行为 |
| --- | --- | --- |
| `MAX_REQUEST_BYTES` | 16384 字节 | API 写请求按实际接收字节限制，超出 413 |
| `REQUESTS_PER_MINUTE` | 每 IP 120 次 | 所有 `/api/` 请求共用，超出 429 |
| `SESSION_CREATES_PER_HOUR` | 每 IP 每小时 10 次 | 防止匿名创建刷库 |
| `CHATS_PER_MINUTE` | 每 IP 每分钟 30 次 | 聊天入口限制 |
| `AI_MAX_PARALLEL` | 4 | 同实例在途生成上限；同请求合并 |
| `AI_DAILY_CALL_LIMIT` | 每 UTC 日 200 次 | SQLite 原子预留，重启后保留，午夜换日 |
| `MAX_SESSIONS` | 1000 | 超过容量停止新建会话 |
| `MAX_COMMANDS_PER_SESSION` | 1000 | 限制每个会话的幂等快照数量；达到后需新建会话 |
| `MAX_DATABASE_BYTES` | 512 MiB | 主库和 WAL 大小的软上限，超过后停止新增写入 |
| `SESSION_TTL_SECONDS` | 30 天 | 按最近活动时间过期 |
| `CLEANUP_INTERVAL_SECONDS` | 1 小时 | 启动时及周期性删除过期会话与其幂等历史 |

以上值可通过 `.env` 和 Compose 覆盖，必须为正整数。企业/校园网络共享出口会共用 IP 限额，正式并发人数确定后再调整。限流计数驻内存，重启重置，不适用于多实例统一限流；AI 日预算持久化，二者不能混为一谈。

代理部署只信任明确配置的上游地址；后端不自行解析任意 `X-Forwarded-For`。Uvicorn 在代理地址被允许后才可更新客户端 IP。不要将 `--forwarded-allow-ips '*'` 用于能被公网直接访问的后端，否则会允许伪造地址绕过限流。`/health` 不限流，便于探活。

限流返回 `RATE_LIMITED` 和 `Retry-After`；前端应等待后使用原请求重试。请求体超限返回 `REQUEST_TOO_LARGE`。`AI_DAILY_LIMIT` 表示 UTC 当天尝试预算耗尽，不能立即无限重试。会话失效使用原有 `INVALID_SESSION`，可提示重新开始。

## 费用边界

每次实际进入 provider 前预留一次调用，失败、超时、取消以及状态冲突都可能已经在供应商侧产生费用，因此不自动退还计数。同一成功请求重放不再扣减；同进程同请求并发等待共用调用。

这是调用次数预算，**不是金额预算**。模型、单价、上下文长度和最大输出 token 尚未确定。拿到宋浩然的模块后，需在适配器中设置输入/输出 token 上限、SDK 重试上限，以及供应商账户的金额硬上限，再换算可接受的日调用数。若适配器内部重试多次，一次预留可能对应多次供应商调用，必须在接入验收时限制并计入成本。

## 数据保留与清理

新增 `session_activity` 和 `ai_daily_usage` 表；旧版数据库首次升级时，把现有会话的保留期起点设为升级时间，不猜测原创建时间。再次启动不会延长所有旧会话的保留期。读取有效会话及成功写入会续期；续期和清理使用互斥事务，避免刚恢复的会话被并发删除。

过期后 token 无法再恢复会话，自动清理同时删除会话状态和历史幂等响应。reset 仍然不是隐私删除接口。备份可能保留更早的对话，备份保留期需在部署时单独约定。

手动预览和执行（使用与服务相同的限额环境）：

```bash
uv run --env-file .env python scripts/maintenance.py data/story-shop.sqlite3
uv run --env-file .env python scripts/maintenance.py data/story-shop.sqlite3 --apply
```

清理逻辑记录后 SQLite 文件不一定变小。磁盘配额触发时，先备份、停止服务，再回收空间：

```bash
uv run --env-file .env python scripts/maintenance.py data/story-shop.sqlite3 --apply --vacuum
```

`--vacuum` 要求操作者先停止服务，脚本不能替代进程管理。512 MiB 是写入前的软检查，存在单次写入和并发超出，应在服务器磁盘/容器层再设硬配额。不要把 SQLite 主文件直接删掉来“清理”。

## 备份与恢复

备份通过 SQLite online backup API，包含 WAL 已提交数据；目标独占创建、权限 0600，并执行完整性检查。现有文件绝不覆盖。

```bash
uv run python scripts/backup.py data/story-shop.sqlite3 data/backup-20260914.sqlite3
uv run python scripts/restore.py data/backup-20260914.sqlite3 data/restored-20260914.sqlite3
```

恢复先生成新的数据库文件。确认完成后停止服务，将 `DATABASE_PATH` 指向新文件再启动。原数据库保留，便于回退。恢复后的会话仍按备份中的活动时间判断是否过期；不会复活已经超过保留期的会话。浏览器 token 必须仍在，仅有数据库不能找回用户已清除的凭据。

AI 日预算也在数据库里，但恢复旧备份会恢复到旧计数，可能低于真实已付费调用数。若当天恢复生产库，应先停用真实模型并核对供应商用量，校正限额后再开放；供应商账户金额上限仍是最终费用保护。

目前提供已验证的备份/恢复命令，服务器未提供，尚未创建定时备份任务或异地备份位置。部署后应每日备份到受控位置，并至少做一次恢复演练。

## 部署预检

Compose 已传递上述限额，数据库保留在命名卷；根文件系统只读、临时目录可写、非 root 运行并移除多余 capabilities。真实模型模块新增的缓存/模型文件路径需要明确挂载，不能依赖写入应用目录。Docker 服务未启动的本机只能验证 Compose 配置，容器构建和容器启动需在可用环境补验。

```bash
docker compose config --quiet
# 后端启动后，检查存储、CORS 和响应追踪头：
uv run python scripts/preflight.py --base-url http://127.0.0.1:8000 --origin http://127.0.0.1:5178
# 真实共享环境发布前，严格检查（替换为实际地址）：
uv run python scripts/preflight.py --base-url https://YOUR_BACKEND_HOST \
  --origin https://YOUR_FRONTEND_HOST --public --require-custom-ai --require-verified-content
```

预检不创建会话、不调用收费模型。`custom` 仅表示模块已加载，不能证明供应商网络、凭据或自然语言质量通过。当前正文核对标记为 false，严格预检会如实失败；受控联调可以不加正式内容要求，但应保留联调标识。

## 下一份交接材料

王泽轩需要按 [正式章节协议](formal-chapter.md) 接播放器，并提供可运行分支。刘文浩负责复测开始、逐段确认、刷新恢复、寄展确认及重置；目前后端的这些路径有自动化测试，前端真实播放器尚未联调。

宋浩然需要交付异步模块入口、依赖、环境变量名称、供应商/模型标识、内部重试与 token 上限，以及正常/失败样例。刘文浩已有 `AI_PROVIDER_FACTORY` 入口和调用保护；实际凭据通过部署环境注入，不发到群聊、文档或仓库。

部署需要目标服务器或托管项目、后端和前端域名、访问方式以及备份位置。拿到这些信息后，才能配置 HTTPS、反向代理可信地址、真实 CORS、供应商密钥及共享链接。当前尚未执行外部部署，也未代替任何人发送消息。
