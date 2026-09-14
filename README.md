# 故事旧货铺

![故事旧货铺](./story-poster.png)

每一件旧物，都藏着一段未完的故事。

在这家特别的旧货铺里，你将检查旧物、与看山自由交谈，逐步发现物件背后的人与经历。

用静态插图与文字展开故事，让旧物入店，让故事入册。

## 前端交互样例（王泽轩）

前端在 `frontend/`，可以独立体验第一章的页面与交互。当前使用明确标识的本地样例回应和 SVG 占位素材；真实 AI、后端实际联调、正式剧情配置与美术验收待后续对接。

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

后续联调可参考 `frontend/.env.example` 切换 HTTP 适配器。HTTP 请求形状已按后端分支准备并做模拟测试，不代表已经通过真实服务联调。
