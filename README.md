# celadon

长期运行、自我优化的**仓库值守 Agent**：盯住任意一个目标仓库（`xgateway`、`xlite`、或任何 `owner/name`），每天午夜深度扫描、每 6 小时快速巡检，发现问题记录进持久记忆，紧急问题直接呼叫（page）人类。换目标仓库只需要改一个环境变量 `TARGET_REPO`。

基于 [Flue](https://flueframework.com/)（Agent harness）+ Cloudflare Workers（cron 触发）+ Durable Objects（记忆 + 配置）。

## 管理页面

打开 `https://celadon.chat/`，**登录 `admin` / `admin123`**（浏览器会话，30 天有效）。主界面就是聊天，桌面 / 平板 / 手机自适应。

- **对话**（主页面）：普通 AI 聊天窗口，Markdown/代码块、思考动画、实时回复；手机端右上角 ⚙️ 进设置
- **设置**（独立页面）：目标仓库、GitHub（Token 或 OAuth 连接 + 选仓库）、计划任务（文案 + 开关 + 立即运行）、Agent 附加指令、告警状态、退出登录
- 底部保存条，未保存修改有提示

管理 API（登录后会话 Cookie 或 Bearer `KEEPER_API_KEY` 均可）：

```
POST /api/login / /api/logout / GET /api/session   会话
GET  /api/status         总览（仓库 / GitHub / 告警 / 模型 / cron）
GET  /api/config         读配置
PUT  /api/config         改配置 {repo, extra, daily, quick, github}
POST /api/run            立即运行 {slot:"daily"|"quick"}
POST /api/github/connect + /api/github/callback + /api/github/repos   GitHub 授权链路
POST /agents/keeper/nightly   对话
```

### GitHub 授权（弹窗连接用）

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App
   - Homepage URL：`https://celadon.chat`
   - Authorization callback URL：`https://celadon.chat/api/github/callback`
2. 把 Client ID / Client Secret 存进 Cloudflare：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

授权后获得的 token 存在 ConfigStore，仓库工具自动优先用它；未连接时退回 `GITHUB_TOKEN` 或 GitHub App。

## 工作方式

```
Cloudflare Cron Trigger (wrangler.jsonc)
   ├─ 0 0 * * *    午夜深度扫描
   └─ 0 */6 * * *  每 6 小时快速巡检
          ↓ dispatch(Keeper, { id: 'nightly', message })
   Flue Durable Object: FlueKeeperAgent（同一个长跑会话 'nightly'）
          ├─ repo_list / repo_read / repo_search / repo_ci   读 GitHub 仓库做分析
          ├─ open_issue 在 GitHub 开 issue（告警/跟踪直接落在仓库里）
          ├─ remember   写持久记忆（跨天累积）
          ├─ update_playbook  改写自己的操作手册 → 自我优化
          └─ page       呼叫人类（PagerDuty / webhook）
```

- **长跑**：所有定时触发都投递到同一个会话 `nightly`，记忆、playbook、上下文逐夜延续。
- **记忆**：`usePersistentState` 存在该 Agent 的 Durable Object（SQLite）里，重启/重新部署都不丢。
- **自我优化**：每次运行结束前，Agent 用 `update_playbook` 把学到的问题热点、误报模式、更省 token 的扫描顺序写回自己的操作手册，下个周期立即生效。

## 目录

```
src/app.ts            HTTP 入口（会话 / 页面 / 管理 API / 挂载 agent）
src/public/index.html 管理页面（完整 SPA：登录、聊天、设置、GitHub 弹窗）
src/config.ts         配置读写（ConfigStore Durable Object）
src/cloudflare.ts     ConfigStore DO 定义 + scheduled handler：cron → dispatch
src/agents/keeper.ts  Agent 本体（'use agent'，工具、记忆、playbook）
src/tools/repo.ts     GitHub API（列表/读文件/代码搜索/CI 结果/开 issue）
src/tools/pager.ts    呼叫人类（PagerDuty Events v2 或 webhook）
test/pager.test.ts    node --test 自检
```

## 部署

```bash
npm install
# GitHub App 认证（推荐）：见下节
npx wrangler secret put GITHUB_APP_PRIVATE_KEY   # .pem 全文（含 BEGIN/END 行）
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_INSTALLATION_ID
npx wrangler secret put KEEPER_API_KEY          # 对外 HTTP 的访问密钥
npx wrangler secret put PAGER_ROUTING_KEY       # 可选，PagerDuty
npm run deploy                                  # vite build && wrangler deploy
```

### GitHub App（替代个人 token）

1. GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App：
   - Repository permissions：**Contents: Read-only**、**Issues: Read & write**、**Actions: Read-only**
   - Webhook 可以关掉（不需要）
2. 创建后记下 **App ID**，点 **Generate a private key** 下载 `.pem`
3. **Install App** 装到目标仓库（如 `EeroEternal/xgateway`），安装页地址里那串数字就是 **Installation ID**（也可查 `GET /app/installations`）
4. 把三个值 `wrangler secret put` 进去（见上）

celadon 会自己用私钥签 JWT 去换 **installation access token**（1 小时有效，自动缓存续期），不再需要长期 PAT。本地开发仍可用 `GITHUB_TOKEN` 兜底。

## 配置（环境变量 / wrangler secrets & vars）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `TARGET_REPO` | 被守护的仓库 `owner/name`（必填，换仓库只改这里） | `EeroEternal/xgateway` |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_INSTALLATION_ID` | GitHub App 认证（推荐，自动换短时 token） | — |
| `GITHUB_TOKEN` | 个人 token，本地开发兜底（可选） | — |
| `PAGER_ROUTING_KEY` | PagerDuty Events v2 routing key | — |
| `PAGER_WEBHOOK_URL` | 兜底告警 webhook（JSON POST） | — |
| `KEEPER_API_KEY` | 对外 HTTP（页面 / API / 对话）的访问密钥 | — |
| `KEEPER_MODEL` | 模型 specifier | `cloudflare/@cf/moonshotai/kimi-k2.6`（Workers AI，无需 key） |

定时周期在 `wrangler.jsonc` 的 `triggers.crons` 里改（UTC 时间），消息文案在 `src/cloudflare.ts`。

## 本地

```bash
npm run check                 # tsc --noEmit + node --test
npm run build                 # 产出 Cloudflare Worker
npm run scan -- --message "看看 CI 最近怎么样"   # 本地跑一次（需 KEEPER_MODEL 指向你有 key 的模型）
curl localhost:5173/agents/keeper/nightly -X POST -H 'content-type: application/json' \
  -d '{"kind":"user","body":"做一次快速巡检"}'
```

## 备注

- 记忆目前只用 Durable Object（SQLite），够用且零配置；若要归档每晚的完整报告/大文件，再加一个 R2 bucket 绑定即可。
- `/agents/keeper` 挂载还没有鉴权，公开暴露前请先加中间件。
