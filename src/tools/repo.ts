// GitHub access for the target project. Plain fetch helpers, no framework imports,
// so they stay testable and usable from scripts.
//
// Auth: a GitHub App (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_INSTALLATION_ID)
// mints short-lived installation tokens; GITHUB_TOKEN still works as a dev fallback.

import { createPrivateKey, sign as rsaSign } from 'node:crypto';
import { getConfig } from '../config.ts';

const API = 'https://api.github.com';

/** Build the RS256 JWT a GitHub App authenticates with (pure: takes clock + key). */
export function appJwt(appId: string, privateKeyPem: string, nowSeconds: number): string {
	const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
	const payload = Buffer.from(
		JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }),
	).toString('base64url');
	const data = `${header}.${payload}`;
	const sig = rsaSign('sha256', Buffer.from(data), createPrivateKey(privateKeyPem)).toString('base64url');
	return `${data}.${sig}`;
}

let cachedToken: { token: string; exp: number } | null = null;

async function appInstallationToken(): Promise<string> {
	if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
	const appId = process.env.GITHUB_APP_ID;
	const installationId = process.env.GITHUB_INSTALLATION_ID;
	const pem = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
	if (!appId || !installationId || !pem) throw new Error('Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_INSTALLATION_ID');
	const jwt = appJwt(appId, pem, Math.floor(Date.now() / 1000));
	const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${jwt}`,
			accept: 'application/vnd.github+json',
			'user-agent': 'celadon',
		},
	});
	if (!res.ok) throw new Error(`GitHub app auth -> ${res.status} ${await res.text()}`);
	const data = (await res.json()) as { token: string; expires_at: string };
	cachedToken = { token: data.token, exp: Date.parse(data.expires_at) };
	return cachedToken.token;
}

async function token(): Promise<string> {
	const connected = (await getConfig()).github.token;
	if (connected) return connected;
	if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
	return appInstallationToken();
}

async function repo(): Promise<string> {
	const r = (await getConfig()).repo || process.env.TARGET_REPO || '';
	if (!r) throw new Error('No target repo configured (set it on the web page or TARGET_REPO)');
	return r;
}

async function gh(path: string, init?: { method?: string; body?: string }): Promise<unknown> {
	const res = await fetch(`${API}${path}`, {
		method: init?.method ?? 'GET',
		body: init?.body,
		headers: {
			authorization: `Bearer ${await token()}`,
			accept: 'application/vnd.github+json',
			'user-agent': 'celadon',
		},
	});
	if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${await res.text()}`);
	return res.json();
}

/** List file names under a directory in the repo. */
export async function repoList(path = ''): Promise<string[]> {
	const data = (await gh(`/repos/${await repo()}/contents/${path}`)) as Array<{ name: string; type: string }> | null;
	if (!data) return [];
	return data.map((e) => `${e.type === 'dir' ? e.name + '/' : e.name}`);
}

/** Read one file. Truncated to 50KB so a big file cannot blow up the context. */
export async function repoRead(path: string): Promise<string> {
	const data = (await gh(`/repos/${await repo()}/contents/${path}`)) as { content?: string; type?: string };
	if (data.type === 'dir') return `Directory listing:\n${(await repoList(path)).join('\n')}`;
	const text = Buffer.from(data.content ?? '', 'base64').toString('utf8');
	return text.length > 50_000 ? `${text.slice(0, 50_000)}\n...[truncated]` : text;
}

/** Code search across the repo (e.g. query "unwrap repo:owner/name"). */
export async function repoSearch(query: string): Promise<string[]> {
	const q = query.includes('repo:') ? query : `${query} repo:${await repo()}`;
	const data = (await gh(`/search/code?q=${encodeURIComponent(q)}&per_page=20`)) as {
		items?: Array<{ path: string }>;
	};
	return (data.items ?? []).map((i) => i.path);
}

/** Recent workflow runs, failures first. */
export async function repoCi(): Promise<Array<{ name: string; conclusion: string | null; url: string }>> {
	const data = (await gh(`/repos/${await repo()}/actions/runs?per_page=15`)) as {
		workflow_runs?: Array<{ name: string; conclusion: string | null; html_url: string }>;
	};
	const runs = (data.workflow_runs ?? []).map((r) => ({
		name: `${r.name}: ${r.conclusion ?? 'running'}`,
		conclusion: r.conclusion,
		url: r.html_url,
	}));
	return runs.sort((a, b) => Number(a.conclusion === 'success') - Number(b.conclusion === 'success'));
}

/** Open an issue in the target repo and return its URL. */
export async function repoOpenIssue(title: string, body: string): Promise<string> {
	const data = (await gh(`/repos/${await repo()}/issues`, {
		method: 'POST',
		body: JSON.stringify({ title: title.slice(0, 256), body }),
	})) as { html_url: string; number: number };
	return `Issue #${data.number} opened: ${data.html_url}`;
}
