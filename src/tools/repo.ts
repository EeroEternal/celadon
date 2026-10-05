// GitHub access for the target project. Plain fetch helpers, no framework imports,
// so they stay testable and usable from scripts.

const API = 'https://api.github.com';

function token(): string {
	const t = process.env.GITHUB_TOKEN;
	if (!t) throw new Error('GITHUB_TOKEN is not set');
	return t;
}

function repo(): string {
	const r = process.env.TARGET_REPO;
	if (!r) throw new Error('TARGET_REPO is not set (owner/name of the repo to keep)');
	return r;
}

async function gh(path: string): Promise<unknown> {
	const res = await fetch(`${API}${path}`, {
		headers: {
			authorization: `Bearer ${token()}`,
			accept: 'application/vnd.github+json',
			'user-agent': 'bonsai',
		},
	});
	if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${await res.text()}`);
	return res.json();
}

/** List file names under a directory in the repo. */
export async function repoList(path = ''): Promise<string[]> {
	const data = (await gh(`/repos/${repo()}/contents/${path}`)) as Array<{ name: string; type: string }> | null;
	if (!data) return [];
	return data.map((e) => `${e.type === 'dir' ? e.name + '/' : e.name}`);
}

/** Read one file. Truncated to 50KB so a big file cannot blow up the context. */
export async function repoRead(path: string): Promise<string> {
	const data = (await gh(`/repos/${repo()}/contents/${path}`)) as { content?: string; type?: string };
	if (data.type === 'dir') return `Directory listing:\n${(await repoList(path)).join('\n')}`;
	const text = Buffer.from(data.content ?? '', 'base64').toString('utf8');
	return text.length > 50_000 ? `${text.slice(0, 50_000)}\n...[truncated]` : text;
}

/** Code search across the repo (e.g. query "unwrap repo:owner/name"). */
export async function repoSearch(query: string): Promise<string[]> {
	const q = query.includes('repo:') ? query : `${query} repo:${repo()}`;
	const data = (await gh(`/search/code?q=${encodeURIComponent(q)}&per_page=20`)) as {
		items?: Array<{ path: string }>;
	};
	return (data.items ?? []).map((i) => i.path);
}

/** Recent workflow runs, failures first. */
export async function repoCi(): Promise<Array<{ name: string; conclusion: string | null; url: string }>> {
	const data = (await gh(`/repos/${repo()}/actions/runs?per_page=15`)) as {
		workflow_runs?: Array<{ name: string; conclusion: string | null; html_url: string }>;
	};
	const runs = (data.workflow_runs ?? []).map((r) => ({
		name: `${r.name}: ${r.conclusion ?? 'running'}`,
		conclusion: r.conclusion,
		url: r.html_url,
	}));
	return runs.sort((a, b) => Number(a.conclusion === 'success') - Number(b.conclusion === 'success'));
}

export function repoSlug(): string {
	return repo();
}
