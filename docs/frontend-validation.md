# 前端验证记录

> 2026-09-15 更新：新版连续放映前端与现有素材已接入并完成本地联调，见 [新版前端交接与验收](frontend-screening-handoff.md)。下文保留此前的盘点/探索样例记录，不能据此判断新版仍未实现。

2026-09-14，分支 `feat/wangzexuan-frontend`。此前的独立前端验证已通过；合并阶段又补充了本地 FastAPI + SQLite 的真实 HTTP 联调，见 [本地联调记录](local-integration.md)。真实 AI 与公网部署尚未验收。

| 检查 | 结果 | 覆盖 |
| --- | --- | --- |
| TypeScript + Vite production build | 通过 | `npm run build`，可生成 `frontend/dist/` |
| 状态与适配器单元检查 | 8 / 8 通过 | 原请求重试、幂等冲突、提前猜测、未知细节、读页不披露、重复收藏、恢复/重置版本、旧响应、HTTP 字段与错误解析 |
| Playwright 桌面 | 4 / 4 通过 | 1440 × 1000 Chromium |
| Playwright 手机布局 | 4 / 4 通过 | 390 × 844 Chromium 模拟移动视口（不代表真机 Safari 验收） |
| 浏览器完整流程 | 通过 | 营业、检查机身/两张照片/背面、输入保留、刷新继续、四次建议路径、分段故事页、取消接收、双击确认、跳过动画、收藏来源占位、再次刷新、取消和确认重置 |
| 异常与交互 | 通过 | 注入一次失败、刷新后原请求重试、消息不重复、未知病情不解锁、空白输入禁发、等待时新草稿不被清空、弹窗焦点限制/Escape 返回 |
| 浏览器运行与布局 | 通过 | 完整流程无 pageerror，移动视口无横向溢出；已视觉回查欢迎页、主界面、检查、故事与收藏截图 |
| 格式检查 | 通过 | `npm run format:check` |
| Git 空白检查 | 通过 | `git diff --check` |

## 可复现命令

```bash
cd frontend
npm ci
npx playwright install chromium --only-shell
npm test
npm run build
npm run test:e2e
npm run format:check
```

Playwright 会启动 5178 端口（本地已有本项目服务可复用）。测试使用独立浏览器上下文，不更改日常浏览器里的存档。截图在被 Git 忽略的 `frontend/test-results/`；本次最终截图另行保留在同级 `gushijiuhuopu-项目档案/2026-09-14前端交付/`，不随公开代码提交。

## 仍未验收

- 共享部署环境的 CORS、真实外网超时/响应丢失与并发、真实 AI 语义表现；本机精确 origin 的 CORS 和正常 HTTP 全流程已验证。
- 产品最终剧情/事实披露条件、原文作者与来源授权、最终美术素材的同屏适配。
- 真机 Safari / Android、5—8 分钟实际体验时长与 3—5 人用户试玩。
- 公网部署、提交赛事。当前仅本机预览，不把可运行样例称作已上线版本。
