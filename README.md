# 故事旧货铺

每一件旧物，都藏着一段未完的故事。玩家经营旧货铺，与看山交流、检查旧物，沿着文字和画面了解它背后的经历。

![故事旧货铺](./story-poster.png)

当前开放第一章《遗失的晴天》，支持 Galgame 式逐句阅读、背景音乐、双音色配音、受剧情约束的 AI 对话和书本式收藏册。故事完成后可「重新体验」，已有收藏保留。

## 团队接手入口

- **[完整版本交接：本轮改动、启动、配置与验收](docs/2026-09-15-完整版本交接.md)**
- [看山通用角色提示词](app/kanshan_prompt.md) · [AI 接入说明](docs/看山-AI对话接入说明.md)
- [配音制作与动态声音](docs/reference-voice-production.md)
- [最新接口快照](docs/contracts/openapi.json)
- [产品说明计划书](docs/故事旧货铺-产品说明计划书.md)
- [部署步骤](deploy/README.md) · [服务器与域名交接](docs/infrastructure-handoff.md)

## 快速体验

安装 Python 3.11+、uv 与 Node.js 后：

```bash
uv sync --locked
cd frontend
npm ci
npm run dev:screening
```

打开 `http://127.0.0.1:5180`。此快捷命令使用无需密钥的脚本问答；真实 AI 的配置与启动方式见交接文档。

固定配音可直接播放。动态 AI 配音当前使用本机独立语音服务，生产环境需另行配置。密钥、数据库、原始参考录音与本地模型环境不在仓库内。

当前分支为 `feat/frontend-screening`，通过 [PR #6](https://github.com/chenjieliefu/gushijiuhuopu/pull/6) 交付团队。公网部署仍待完成；GitHub 上传并不代表网站已上线。
