// App configuration: repo to watch, periodic tasks, extra instructions.
// Stored in the app-owned ConfigStore Durable Object (see cloudflare.ts),
// readable from the Worker (scheduled handler, admin API) and from agent tools.

export interface KeeperConfig {
	repo: string;
	extra: string;
	github: { token: string; login: string };
	daily: { enabled: boolean; task: string };
	quick: { enabled: boolean; task: string };
}

export const DEFAULT_CONFIG: KeeperConfig = {
	repo: process.env.TARGET_REPO ?? '',
	extra: '',
	github: { token: '', login: '' },
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
			console.error('bonsai: CONFIG binding missing', Object.keys(env));
			return null;
		}
		return ns.get(ns.idFromName('default'));
	} catch (e) {
		console.error('bonsai configDo error:', e);
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
