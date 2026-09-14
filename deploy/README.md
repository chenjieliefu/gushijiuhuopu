# 故事旧货铺发布准备

目标域名：`https://gushi.zexuan-604.com`。这些是待执行的配置，不代表上线完成。

## 发布约定

- 项目独立目录 `/opt/story-shop/`，独立 Compose 项目 `story-shop` 与数据库卷。
- 保留 `read.zexuan-604.com`、`qingdeng.zexuan-604.com` 的站点配置、服务与数据。
- 登录后先检查当前 Nginx 配置、监听端口、磁盘、Docker 和现有证书；候选后端回环端口 `18089`，冲突时同步调整 Compose 与 Nginx。
- 使用最新本地源码与美术；不打包 `.env`、本地数据库、SSH 凭据、基础设施截图或原始素材归档。
- 第一章使用 `AI_MODE=custom` 与 `app.story_ai:create_provider`。通过 OpenAI 兼容接口生成受剧情约束的回答。
- 启动前在服务器创建 `/opt/story-shop/shared/backend.env`（权限 600），配置 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`。密钥必须独立传入，不进入仓库、镜像和前端。
- 已制作的 51 句旁白、20 句看山配音直接随静态资源发布。动态 AI 配音当前由本机 Apple Silicon 的独立语音服务生成；生产服务器需另接可达的参考音色服务并设置 `VOICE_SERVICE_URL`，不能直接运行本机路径或把轻量服务器当作 MLX 主机。未配置动态语音时，新的 AI 回答仍以字幕正常显示。

## 部署顺序

1. 完成服务器登录，盘点并备份原有 Nginx 配置。
2. 上传发布包至独立 releases 目录，建立该版本的镜像；启动单实例后端，检查回环健康接口。
3. 为本项目单独添加 HTTP 虚拟主机，测试 Nginx 配置后 reload。
4. 通过 ACME 验证本项目域名并签发 HTTPS 证书；使用服务器现有证书管理工具时，适配模板证书路径。
5. 将 `current` 软链切换到本次发布目录，加载项目 HTTPS 虚拟主机。Nginx 配置测试失败时不 reload。
6. 执行公网预检、浏览器逐句阅读/收藏/刷新恢复验收，确认其他原有站点保持可用。
7. 数据库使用仓库 `scripts/backup.py` 通过 SQLite backup API 备份，制定每日备份及保留方案，完成一次恢复验证。

前端构建使用：

```sh
VITE_TRANSPORT=http VITE_API_BASE_URL=https://gushi.zexuan-604.com npm run build
```

在发布根目录启动后端：

```sh
docker compose -f deploy/compose.production.yaml up --build -d
```

预检：

```sh
python scripts/preflight.py --base-url https://gushi.zexuan-604.com --origin https://gushi.zexuan-604.com --public
```

## 回退

前端可将 `current` 指回上一完整版本。后端回退前在线备份数据库，确认旧版本支持现有结构后重建旧镜像；不要删除数据库卷。首发失败仅停用本项目容器和新增虚拟主机，保留全部诊断资料。

## 当前实测阻塞

2026-09-15：本机 SSH 公钥未被服务器接受；阿里云控制台需要登录。HTTP 域名返回既有 Nginx 页面，HTTPS 证书域名不匹配。尚未修改服务器、签发证书或发布应用。
