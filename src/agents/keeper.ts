'use agent';

import { useModel, usePersistentState, useTool } from '@flue/runtime';
import * as v from 'valibot';
import { sendPage, type Severity } from '../tools/pager.ts';
import { repoCi, repoList, repoRead, repoSearch, repoSlug } from '../tools/repo.ts';

interface MemoryEntry {
	id: number;
	kind: 'fact' | 'finding' | 'action';
	note: string;
	at: string;
}

const DEFAULT_PLAYBOOK = `1. 先看 CI(repo_ci),失败的 run 是最可信的问题信号。
2. 用 repo_search 扫描高风险模式:unwrap()/expect(、TODO、FIXME、panic!、裸的 clone 滥用、超大函数。
3. 用 repo_read 打开可疑文件,确认问题真实存在,排除误报。
4. 每个确认的问题调用 remember(kind='finding') 记录;紧急问题调用 page。
5. 结束前用 update_playbook 写回本次学到的东西(新的问题热点、误报模式、更省 token 的扫描顺序)。`;

const MemorySchema = v.array(
	v.object({ id: v.number(), kind: v.picklist(['fact', 'finding', 'action']), note: v.string(), at: v.string() }),
);

export function Keeper() {
	useModel(process.env.KEEPER_MODEL ?? 'cloudflare/@cf/moonshotai/kimi-k2.6');

	const [memory, setMemory] = usePersistentState<MemoryEntry[]>('memory', []);
	const [playbook, setPlaybook] = usePersistentState('playbook', DEFAULT_PLAYBOOK);
	const [nextId, setNextId] = usePersistentState('nextMemoryId', 1);

	useTool({
		name: 'remember',
		description:
			'Persist one durable memory entry about the target project. Use kind "fact" for stable knowledge, "finding" for a confirmed problem, "action" for something a human must do. Memory survives across nights and is rendered into future runs.',
		input: v.object({ kind: v.picklist(['fact', 'finding', 'action']), note: v.string() }),
		async run({ data }) {
			const entry: MemoryEntry = { id: nextId, kind: data.kind, note: data.note, at: new Date().toISOString() };
			setNextId(nextId + 1);
			setMemory(v.parse(MemorySchema, [...memory, entry].slice(-200)));
			return `Remembered #${entry.id}: [${data.kind}] ${data.note}`;
		},
	});

	useTool({
		name: 'update_playbook',
		description:
			'Rewrite your own playbook — the operating instructions used by every future run. This is how you self-optimize: fold in what you learned (hot spots, false positives, a cheaper scan order). Replace the whole text; keep it short and concrete.',
		input: v.object({ playbook: v.string() }),
		async run({ data }) {
			setPlaybook(data.playbook);
			return 'Playbook updated.';
		},
	});

	useTool({
		name: 'repo_list',
		description: `List file and directory names in the ${repoSlug()} repository.`,
		input: v.object({ path: v.optional(v.string()) }),
		async run({ data }) {
			return (await repoList(data.path ?? '')).join('\n');
		},
	});

	useTool({
		name: 'repo_read',
		description: `Read one file from the ${repoSlug()} repository by path (truncated to 50KB).`,
		input: v.object({ path: v.string() }),
		async run({ data }) {
			return repoRead(data.path);
		},
	});

	useTool({
		name: 'repo_search',
		description: `Search code in the ${repoSlug()} repository with GitHub code-search syntax (e.g. "panic! path:src").`,
		input: v.object({ query: v.string() }),
		async run({ data }) {
			const hits = await repoSearch(data.query);
			return hits.length ? hits.join('\n') : 'No results.';
		},
	});

	useTool({
		name: 'repo_ci',
		description: `Recent GitHub Actions runs for ${repoSlug()}, failures first.`,
		input: v.object({}),
		async run() {
			const runs = await repoCi();
			return runs.length ? runs.map((r) => `${r.name} — ${r.url}`).join('\n') : 'No workflow runs found.';
		},
	});

	useTool({
		name: 'page',
		description:
			'Page a human about a critical problem that cannot wait for the next scheduled run. Use sparingly: only production breakage or data-loss risk.',
		input: v.object({ severity: v.picklist(['info', 'warning', 'critical']), summary: v.string() }),
		async run({ data }) {
			return sendPage(data.severity as Severity, data.summary);
		},
	});

	return `你是 ${repoSlug()} 项目的长期值守 Agent。每个定时周期被唤醒一次,持续分析与排查该项目的问题,并不断优化自己的工作方式。始终用简体中文输出。

## 工作循环
1. 回顾下方记忆,确定本次重点(不要重复已经确认过的误报)。
2. 扫描:CI 失败、高风险代码模式、超大/可疑文件。
3. 对每个疑似问题:用 repo_read 确认后再下结论,区分「确认问题」与「疑似」。
4. 记录:确认的问题用 remember;需要人处理的用 remember(kind="action");致命问题用 page。
5. 自我优化:本次学到的新热点、误报模式、更高效的扫描顺序,用 update_playbook 写回。

## 输出
本次运行结束时输出一份简短报告:新增问题、已排除的误报、建议的人工动作、以及你对 playbook 做的改动。

## Playbook(你自己维护的操作手册)
${playbook}

## 记忆(持久化,跨天累积,共 ${memory.length} 条)
${memory.map((m) => `#${m.id} [${m.kind}] ${m.note}`).join('\n') || '(空)'}`;
}

Keeper.agentName = 'keeper';
