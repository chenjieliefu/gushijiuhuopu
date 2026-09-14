# 王泽轩 → 刘文浩｜服务器与域名交接

核对时间：2026-09-14 23:42–23:50（UTC+8）。代码与契约核对基线：`main@8ff6df8`。本次交付为资源信息、用户提供的截图和部署交接，并按用户要求新增项目专用子域名；尚未登录服务器、配置 HTTPS 或发布游戏。

**已有阿里云轻量服务器和域名，可以据此准备部署。项目专用子域名已设为 `gushi.zexuan-604.com`；还缺后端登录方式、服务器现有服务/端口盘点和备份位置。** 当前域名已有其他服务解析，不能直接覆盖现有站点。

## 1. 已确认的资源

以下来自当晚已登录阿里云控制台的只读核对，不是从概览截图猜测。

| 项目 | 实际值 / 状态 |
| --- | --- |
| 云产品 | 阿里云轻量应用服务器（不是 ECS 实例） |
| 实例名 | `AlibabaCloudLinux-aojh` |
| 实例 ID | `59015bdf65b544089df970d7cb81ca05` |
| 地域 | 华北2（北京），`cn-beijing` |
| 状态 | 控制台显示运行中；未做 SSH 或应用探活 |
| 公网 IPv4 | `39.106.127.55` |
| 私网 IPv4 | `172.25.33.114` |
| 系统镜像 | Alibaba Cloud Linux `3.21.04` |
| 规格 | 通用型，2 vCPU / 2 GiB 内存 / 40 GiB ESSD 系统盘 |
| 峰值公网带宽 | 控制台显示 200 Mbps；不是实测吞吐或并发承诺 |
| 实例到期 | 2027-05-13 23:59:59 |
| 控制台密钥绑定 | 暂未绑定；不代表没有服务器内手工配置的 SSH key |
| 已有域名 | `zexuan-604.com`，域名状态正常 |
| 域名到期 | 2027-05-13 11:09:41 |
| DNS 服务器 | `dns7.hichina.com` / `dns8.hichina.com` |

云端防火墙现有 4 条启用规则，来源均为 `0.0.0.0/0`：TCP 80、443、22，以及 ICMP 全部。没有看到 8000 端口规则；这与项目让后端仅监听回环地址、由 HTTPS 代理转发的方式一致。操作系统防火墙和实际监听进程还需后端登录后核对。

变更后 DNS（控制台共 3 条，均启用，TTL 10 分钟）：

| 主机记录 | 类型 | 记录值 | 交接约束 |
| --- | --- | --- | --- |
| `gushi` | A | `39.106.127.55` | 本次新增，故事旧货铺项目专用 |
| `read` | A | `39.106.127.55` | 保留，已有用途，不能改成游戏入口 |
| `qingdeng` | A | `39.106.127.55` | 保留，已有用途，不能覆盖 |

项目记录于 2026-09-14 23:47:59（UTC+8）创建，备注“故事旧货铺项目专用”，已回读确认。随后 Google Public DNS 与 Cloudflare DNS 的 HTTPS 查询均返回 `39.106.127.55`（TTL 600 秒），见 [解析验证](../materials/infrastructure/2026-09-14/dns-verification.json)。本机最初的 UDP 查询曾返回 NXDOMAIN，不能据此否定后续独立解析结果；不同客户端仍可能受旧缓存影响。变更前仅有 read、qingdeng 两条，本次新增后两条旧记录的值、TTL、状态和更新时间均保持不变。ICP备案仅打开到“可备案实例管理”，没有核实到本域名的备案成功记录，因此备案状态记为**待核对**，不推断为已备案或未备案。项目 HTTPS 证书同样未核验。

## 2. 给后端的部署建议（尚未执行）

项目使用独立子域名 `gushi.zexuan-604.com`，A 记录已创建。建议前端与 API 同源；目标 origin 为 `https://gushi.zexuan-604.com`，HTTPS 与应用尚待部署。后端需新增项目专用虚拟主机，保留现有 `read`、`qingdeng` 的配置与数据；主域名不用于本项目。

```text
DNS 已创建：gushi.zexuan-604.com → A 记录 39.106.127.55
HTTPS 443 → 前端静态文件 frontend/dist/
          → /api/* 和 /health 原路径转发至 127.0.0.1:8000
后端 Docker 单实例 → 独立 SQLite 命名卷
```

先盘点端口：仓库 `compose.yaml` 固定绑定 `127.0.0.1:8000`，不能假设这台已有用途的服务器上该端口空闲。如冲突，后端选定项目专用回环端口，并同时修改代理 upstream。部署目录与 Compose project name 也应独立。

前端构建时明确使用 `VITE_TRANSPORT=http`，`VITE_API_BASE_URL` 填最终的 **HTTPS origin，不加 `/api`**，因为适配器自身会附加 `/api/...`。这些是构建变量，修改后需重新构建。当前留空会回退 `http://127.0.0.1:8000`，不可把空值当作自动同源。

后端 `CORS_ORIGINS` 对齐最终前端 origin；`scripts/preflight.py --origin` 会检查对应许可头。代理信任地址、数据库卷、日志、调用预算和备份恢复沿用 [运行保障](backend-operations.md) 与 [部署说明](deployment.md)，以登录服务器后的实际环境为准。

## 3. 接手顺序与缺失项

| 接手事项 | 当前状态 | 协作方 / 完成判据 |
| --- | --- | --- |
| SSH 登录账号、端口及授权方式 | IP 已有，账号与凭据未交付；未登录 | 王泽轩与刘文浩确定可用访问方式，后端实际连接成功；私钥/密码通过单独受控渠道交付，不写仓库 |
| 现有服务、代理及端口 | DNS 证明已有两条其他用途解析，服务器进程未盘点 | 刘文浩登录后盘点监听端口、代理配置、磁盘和 Docker 环境，确定独立部署目录与端口 |
| 项目子域名 | `gushi.zexuan-604.com` A 记录已创建并回读 | 后端配置 HTTPS 与虚拟主机；同源目标 frontend origin / API base URL 均为 `https://gushi.zexuan-604.com` |
| 备案、HTTPS | 尚未核验 | 资源持有人与后端核对控制台记录及本项目域名证书，保留实际结果 |
| 环境版本 | 新版连续放映前端已完成本地联调，见 [前端交接](frontend-screening-handoff.md) | 新版前端连接 `lost-sunshine.json`；旧探索入口仍使用 demo，部署时明确匹配 |
| AI 模块 | `custom` 工厂入口已有；真实 provider 未交付 | 宋浩然提供模块、依赖、环境变量名和样例；后端部署环境注入凭据并验证 |
| 备份位置及保留期 | 脚本已有，服务器定时任务与备份位置未设置 | 刘文浩确定受控存储路径、执行账号、频率与保留期，实际完成备份恢复演练 |
| 共享试玩验收 | 本次未部署、未运行公网验收 | 回填部署 commit、地址、预检结果、真实浏览器完整流程与重启恢复结果 |

可先让旧前端连接 `STORY_PATH=stories/demo.json` / `AI_MODE=mock` 验证部署链路。新版播放器接入后，受控测试使用 `STORY_PATH=/app/stories/lost-sunshine.json` / `AI_MODE=scripted`（这里是容器内路径）。接入真实模块后再使用 `AI_MODE=custom`；不能将 scripted 说成 AI 已接通。

发布后执行仓库已有预检：`scripts/preflight.py --base-url <实际 HTTPS origin> --origin <实际前端 origin> --public`；正式 AI/原文验收时再增加 `--require-custom-ai --require-verified-content`。当前 `original_verified=false`，严格内容预检预期不能通过。

## 4. 前端责任与现有资料

王泽轩负责页面、美术素材接入、连续播放器、放映前后交流界面、寄展确认、收藏及恢复交互；刘文浩负责 API、状态/进度校验、部署与运行保障；宋浩然对接真实 AI。新版前端所需材料已整理到 [素材与交互现状索引](frontend-materials-status.md)。

## 5. 证据入口

- [用户提供的阿里云概览原截图](../materials/infrastructure/2026-09-14/aliyun-overview-user.png)：原样归档；只证明资源概况，不含具体 IP/域名配置。包含账户和浏览器界面，仅用于当前私有团队仓库交接。
- [只读核对摘录](../materials/infrastructure/2026-09-14/console-readback.json)：实例、防火墙、域名、DNS 变更前后控制台正文相关片段，不包含登录凭据。
- [实例控制台](https://swasnext.console.aliyun.com/servers/cn-beijing/59015bdf65b544089df970d7cb81ca05/dashboard)、[防火墙](https://swasnext.console.aliyun.com/servers/cn-beijing/59015bdf65b544089df970d7cb81ca05/firewall)、[域名列表](https://dc.console.aliyun.com/next/index#/domain-list/all)、[DNS 记录](https://dnsnext.console.aliyun.com/authoritative/domains/zexuan-604.com)：需要有权限的阿里云登录态。

本次没有传递主账号密码、SSH 私钥、AccessKey 或模型 API Key，本次云端写入仅为用户要求的项目子域名 A 记录；未修改服务器、既有 DNS、权限和计费项。截图上传到仓库不代表后端已经取得控制台/SSH 权限。
