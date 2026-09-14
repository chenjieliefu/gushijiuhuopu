# 前后端合并与本地联调

2026-09-14。后端 PR #1 已合入 main（c03ca71），本次合并前端并验证真实 HTTP 调用链。后端仍为 `stories/demo.json` 测试剧情、模拟 AI，没有已知公网地址。

## 验证结果

- 后端 pytest：10 / 10 通过。
- 前端状态/适配器：8 / 8 通过；TypeScript 与生产构建通过。
- 原前端独立样例：桌面/手机 8 条浏览器用例通过。
- **实际 HTTP 联调：桌面 1440 × 1000、手机模拟视口 390 × 844，两条完整流程通过。**没有拦截 fetch 或伪造后端返回。
- 后端 `scripts/smoke.py` 通过，完成收藏并重复请求去重，版本 6，读回 completed。

浏览器路径：创建匿名会话 → 检查 camera_front → 聊天披露测试事实 A → 检查 photo_back → 聊天披露测试事实 B → GET demo_page → 标记已读 → 双击接收只发出一次 collection → 刷新恢复 → 确认 reset。全部 API 响应成功，无浏览器 pageerror。

合并冲突处理：README 保留双方启动/交接内容；.gitignore 合并双方规则，并将后端 `data/` 限定为根目录 `/data/`，避免误忽略前端 `src/data/` 的后续素材配置。

## 复现

从仓库根目录安装后端依赖：`uv sync --locked`。从 frontend 目录安装前端依赖：`npm ci`，首次测试运行 `npx playwright install chromium --only-shell`。

终端 1，在仓库根目录启动独立测试数据库：

```bash
STORY_SHOP_TEST_DIR=$(mktemp -d)
DATABASE_PATH="$STORY_SHOP_TEST_DIR/test.sqlite3" \
  CORS_ORIGINS=http://127.0.0.1:5179 \
  uv run uvicorn app.main:app --host 127.0.0.1 --port 18000
```

终端 2，在 frontend 目录启动 HTTP 前端（不覆盖 5178 的独立样例）：

```bash
VITE_TRANSPORT=http VITE_API_BASE_URL=http://127.0.0.1:18000 \
  npm run dev -- --port 5179
```

终端 3，在 frontend 目录执行：

```bash
npm run test:http
```

浏览器直接访问 http://127.0.0.1:5179 也能手动验证。以上测试会新建匿名测试会话；不要指向生产数据库。本机端口只在服务运行时可用，不是共享部署地址。

## 仍需团队补齐

正式《遗失的晴天》故事配置与披露规则、真实 AI、素材与来源信息、共享测试环境和公网部署。默认 5178 页面仍使用本地交互样例；HTTP 适配器需明确配置开启，两种模式的存档彼此隔离。
