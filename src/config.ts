// App configuration: repo to watch, periodic tasks, extra instructions.
// Stored in the app-owned ConfigStore Durable Object (see cloudflare.ts),
// readable from the Worker (scheduled handler, admin API) and from agent tools.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as v from 'valibot';

// Bearer 访问密钥校验：常量时间比较，支持多个候选（secret 优先，设置页配置的兜底）。
function eq(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function accessKeyMatches(bearer: string | undefined, keys: (string | undefined)[]): boolean {
	if (!bearer) return false;
	return keys.some((k) => !!k && eq(bearer, `Bearer ${k}`));
}

// 登录口令：存 scrypt 哈希（salt:hex），不存明文。
export function hashPass(pass: string): string {
	const salt = randomBytes(8).toString('hex');
	return `${salt}:${scryptSync(pass, salt, 32).toString('hex')}`;
}

export function verifyPass(pass: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const calc = scryptSync(pass, salt, 32);
	const want = Buffer.from(hash, 'hex');
	return calc.length === want.length && timingSafeEqual(calc, want);
}

// 记忆条目：Agent 用 remember 工具写入，跨会话可选继承。
export interface MemoryEntry {
	id: number;
	kind: 'fact' | 'finding' | 'action';
	note: string;
	at: string;
}

export const MemorySchema = v.array(
	v.object({ id: v.number(), kind: v.picklist(['fact', 'finding', 'action']), note: v.string(), at: v.string() }),
);

// 新会话的记忆快照（随 initialData 带进新实例）。脏数据兑底为空，不能让渲染挂掉。
export function parseMemorySeed(raw: unknown): { entries: MemoryEntry[]; nextId: number } {
	const parsed = v.safeParse(MemorySchema, raw ?? []);
	const entries = parsed.success ? parsed.output.slice(-200) : [];
	return { entries, nextId: entries.reduce((m, e) => Math.max(m, e.id), 0) + 1 };
}

// 长期会话 ID：所有定时触发和网页对话都投递到同一个会话。
export const CONVERSATION_ID = 'main';

export interface SessionInfo {
	id: string;
	title: string;
	updatedAt: string;
	/** 新建时选中的记忆来源会话 id（'' = 空白记忆） */
	memoryFrom?: string;
	/** 创建时从记忆库拷贝的快照，经 initialData 带进新实例 */
	seed?: MemoryEntry[];
}

export interface KeeperConfig {
	repo: string;
	model: string;
	apiKeyEnv: string;
	apiKey: string;
	/** 外部应用调用的 Bearer 密钥（设置页可改；留空则只认 Worker secret） */
	accessKey: string;
	/** 管理页登录口令的 scrypt 哈希（设置页可改；未设置则用 ADMIN_PASS secret 或开发默认） */
	adminPass: string;
	github: { token: string; login: string };
	sessions: SessionInfo[];
	/** 记忆库：会话 id -> 记忆条目。remember 工具写回，新会话从这里选一份继承。 */
	memories: Record<string, MemoryEntry[]>;
	daily: { enabled: boolean; task: string };
	quick: { enabled: boolean; task: string };
}

export const DEFAULT_CONFIG: KeeperConfig = {
	repo: process.env.TARGET_REPO ?? '',
	model: '',
	apiKeyEnv: '',
	apiKey: '',
	accessKey: '',
	adminPass: '',
	github: { token: '', login: '' },
	sessions: [],
	memories: {},
	daily: {
		enabled: true,
		task: '午夜深度扫描:完整走一遍工作循环(CI、风险代码模式、可疑文件),更新记忆与 playbook,输出本次报告。',
	},
	quick: {
		enabled: true,
		task: '快速健康检查:只看 CI 失败与上次报告遗留的 action 项,若有生产级问题立即 page,否则一句话汇报。',
	},
};

async function configDo(): Promise<{ get(): Promise<unknown>; set(v: unknown): Promise<void> } | null> {
	try {
		const { env } = (await import('cloudflare:workers')) as { env: Record<string, any> };
		const ns = env.CONFIG;
		if (!ns) {
			console.error('celadon: CONFIG binding missing', Object.keys(env));
			return null;
		}
		return ns.get(ns.idFromName('default'));
	} catch (e) {
		console.error('celadon configDo error:', e);
		return null;
	}
}

export async function getConfig(): Promise<KeeperConfig> {
	const stub = await configDo();
	const stored = ((await stub?.get()) ?? {}) as Partial<KeeperConfig>;
	return {
		...DEFAULT_CONFIG,
		...stored,
		github: { ...DEFAULT_CONFIG.github, ...stored.github },
		model: stored.model ?? DEFAULT_CONFIG.model,
		apiKeyEnv: stored.apiKeyEnv ?? DEFAULT_CONFIG.apiKeyEnv,
		apiKey: stored.apiKey ?? DEFAULT_CONFIG.apiKey,
		accessKey: stored.accessKey ?? '',
		adminPass: stored.adminPass ?? '',
		daily: { ...DEFAULT_CONFIG.daily, ...stored.daily },
		quick: { ...DEFAULT_CONFIG.quick, ...stored.quick },
	};
}

export async function setConfig(patch: Partial<KeeperConfig>): Promise<KeeperConfig> {
	const current = await getConfig();
	const next: KeeperConfig = {
		...current,
		...patch,
		github: { ...current.github, ...patch.github },
		daily: { ...current.daily, ...patch.daily },
		quick: { ...current.quick, ...patch.quick },
	};
	await (await configDo())?.set(next);
	return next;
}

// 记忆库镜像：remember 工具把新记忆写回这里，供以后新建的会话选择继承。
// ponytail: read-modify-write，两个会话并发 remember 会互相覆盖；量小无所谓，
// 真出冲突就把合并挪进 ConfigStore DO 的一个方法里串行化。
export async function appendMemory(id: string, entry: MemoryEntry): Promise<void> {
	const cfg = await getConfig();
	const list = cfg.memories[id] ?? [];
	await setConfig({
		memories: { ...cfg.memories, [id]: [...list.filter((e) => e.id !== entry.id), entry].slice(-200) },
	});
}
