# bonsai

长期运行、自我优化的**仓库值守 Agent**：盯住任意一个目标仓库（`xgateway`、`xlite`、或任何 `owner/name`），每天午夜深度扫描、每 6 小时快速巡检，发现问题记录进持久记忆，紧急问题直接呼叫（page）人类。换目标仓库只需要改一个环境变量 `TARGET_REPO`。

基于 [Flue](https://flueframework.com/)（Agent harness）+ Cloudflare Workers（cron 触发）+ Durable Objects（记忆）。

## 工作方式

```
Cloudflare Cron Trigger (wrangler.jsonc)
   ├─ 0 0 * * *    午夜深度扫描
   └─ 0 */6 * * *  每 6 小时快速巡检
          ↓ dispatch(Keeper, { id: 'nightly', message })
   Flue Durable Object: FlueKeeperAgent（同一个长跑会话 'nightly'）
          ├─ repo_list / repo_read / repo_search / repo_ci   读 GitHub 仓库做分析
          ├─ remember   写持久记忆（跨天累积）
          ├─ update_playbook  改写自己的操作手册 → 自我优化
          └─ page       呼叫人类（PagerDuty / webhook）
```

- **长跑**：所有定时触发都投递到同一个会话 `nightly`，记忆、playbook、上下文逐夜延续。
- **记忆**：`usePersistentState` 存在该 Agent 的 Durable Object（SQLite）里，重启/重新部署都不丢。
- **自我优化**：每次运行结束前，Agent 用 `update_playbook` 把学到的问题热点、误报模式、更省 token 的扫描顺序写回自己的操作手册，下个周期立即生效。

## 目录

```
src/app.ts            HTTP 入口（Hono，挂载 /agents/keeper）
src/cloudflare.ts     scheduled handler：cron → dispatch
src/agents/keeper.ts  Agent 本体（'use agent'，工具、记忆、playbook）
src/tools/repo.ts     GitHub API 读取（列表/读文件/代码搜索/CI 结果）
src/tools/pager.ts    呼叫人类（PagerDuty Events v2 或 webhook）
test/pager.test.ts    node --test 自检
```

## 部署

```bash
npm install
npx wrangler secret put GITHUB_TOKEN        # 读仓库用
npx wrangler secret put PAGER_ROUTING_KEY   # PagerDuty Events v2（可选）
npm run deploy                              # vite build && wrangler deploy
```

## 配置（环境变量 / wrangler secrets & vars）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `TARGET_REPO` | 被守护的仓库 `owner/name`（必填，换仓库只改这里） | `EeroEternal/xgateway` |
| `GITHUB_TOKEN` | GitHub API 访问令牌（必需） | — |
| `PAGER_ROUTING_KEY` | PagerDuty Events v2 routing key | — |
| `PAGER_WEBHOOK_URL` | 兜底告警 webhook（JSON POST） | — |
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
