# 部署、启动与恢复

运行限额、AI 日调用预算、过期清理、备份恢复和部署预检见 [后端运行保障](backend-operations.md)。

当前交付包含部署配置，未创建服务器或公网地址。先在本机或已有测试服务器运行，不需要模型 Key。

## Docker 单实例

```bash
docker compose up --build -d
docker compose ps
curl http://127.0.0.1:8000/health
docker compose logs --tail=50 backend
```

Compose 将主机端口绑定在 `127.0.0.1:8000`，数据库使用命名卷 `story-data`。容器以非 root 用户运行，进程异常时重启。

前端访问不同端口时，通过环境变量设置精确的 `CORS_ORIGINS`。部署到测试服务器后，可以通过已有 HTTPS 反向代理转发到本机 8000 端口，或让前端开发者建立 SSH 转发进行联调。

**不要使用 `docker compose down -v`，它会删除数据卷。** 普通 `docker compose restart` 或重建容器保留卷内进度。

依赖由 `uv.lock` 锁定；Docker 使用从锁文件导出的 `requirements.txt`。调整依赖后执行：

```bash
uv lock
uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file requirements.txt
```

## SQLite 备份与恢复

本地运行时：

```bash
uv run python scripts/backup.py data/story-shop.sqlite3 data/backup-20260913.sqlite3
```

备份通过 SQLite online backup API 生成，不要在服务运行中仅复制主数据库文件而遗漏 WAL。

容器备份可先在线生成一致快照，再复制出来：

```bash
docker compose exec backend python -c "import sqlite3; s=sqlite3.connect('/app/data/story-shop.sqlite3'); d=sqlite3.connect('/tmp/story-shop-backup.sqlite3'); s.backup(d); d.close(); s.close()"
docker compose cp backend:/tmp/story-shop-backup.sqlite3 ./story-shop-backup.sqlite3
```

恢复时先停止所有使用该数据库的进程。将原数据目录整体移到保留目录（包括 `-wal`、`-shm` 文件），新建空数据目录，再把备份放到配置的 `DATABASE_PATH`。保持容器目录 UID 10001 可写。启动后检查 `/health`，使用原会话 token 读取进度。不要在运行中的数据库上覆盖文件。

备份包含对话和历史幂等响应，应与数据库一样控制访问。匿名 token 原文在用户浏览器中，不在数据库里；仅恢复数据库不会恢复用户已经清除的浏览器凭据。

## 演示前核对

- 启动后健康检查正常，SQLite 位于持久卷中。
- 完整运行 `scripts/smoke.py`；重新启动服务后旧 token 仍能读到进度。
- 前端来源和服务地址一致，CORS 允许对应来源。
- 正式剧情与真实 AI 接入后重新验证披露条件、台词、未知细节和故事页展示确认。
- 已补单实例会话/聊天限流、存储软配额、会话过期与清理；面向公网前按实际并发量核对限额，并配置可信代理和供应商金额上限。
