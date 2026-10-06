import { createHash } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { dispatch } from '@flue/runtime';
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Keeper } from './agents/keeper.ts';
import { CONVERSATION_ID, getConfig, setConfig } from './config.ts';
import UI_HTML from './public/index.html?raw';

const app = new Hono();

// ---- demo credentials -------------------------------------------------
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';

function sessionSecret(): string {
	return process.env.SESSION_SECRET || process.env.KEEPER_API_KEY || 'bonsai-dev-secret';
}

function sign(value: string): string {
	return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function issueSession(): string {
	const exp = Date.now() + 30 * 86_400_000;
	return `${exp}.${sign(`s:${exp}`)}`;
}

function validSession(value?: string): boolean {
	if (!value) return false;
	const [exp, mac] = value.split('.');
	if (!exp || !mac) return false;
	if (Number(exp) < Date.now()) return false;
	return safeEqual(mac, sign(`s:${exp}`));
}

// ---- github oauth ------------------------------------------------------
function ghClientId(): string {
	return process.env.GITHUB_CLIENT_ID ?? '';
}

function ghState(): string {
	const ts = Date.now();
	return `${ts}.${sign(`gh:${ts}`)}`;
}

function ghStateValid(state: string): boolean {
	const [ts, mac] = state.split('.');
	if (!ts || !mac) return false;
	if (Date.now() - Number(ts) > 15 * 60_000) return false;
	return safeEqual(mac, sign(`gh:${ts}`));
}

const CALLBACK_HTML = `<!doctype html><meta charset="utf-8"><script>
try { window.opener && window.opener.postMessage({ type: 'gh-connected' }, location.origin); } catch (e) {}
document.write('<p style="font-family:system-ui">GitHub 已连接，可以关闭此窗口。</p>');
setTimeout(function () { window.close(); }, 800);
</script>`;

// ---- auth guard --------------------------------------------------------
const PUBLIC_API = new Set(['/api/login', '/api/github/callback']);

app.use('/api/*', async (c, next) => {
	if (PUBLIC_API.has(c.req.path)) return next();
	const bearer = c.req.header('authorization');
	const cookie = getCookie(c, 'bonsai_session');
	const ok = (bearer && process.env.KEEPER_API_KEY && safeEqual(bearer, `Bearer ${process.env.KEEPER_API_KEY}`)) || validSession(cookie);
	if (!ok) return c.json({ error: 'unauthorized' }, 401);
	await next();
});

app.use('/agents/*', async (c, next) => {
	const bearer = c.req.header('authorization');
	const cookie = getCookie(c, 'bonsai_session');
	const ok = (bearer && process.env.KEEPER_API_KEY && safeEqual(bearer, `Bearer ${process.env.KEEPER_API_KEY}`)) || validSession(cookie);
	if (!ok) return c.json({ error: 'unauthorized' }, 401);
	await next();
});

// ---- session -----------------------------------------------------------
app.post('/api/login', async (c) => {
	const { username, password } = (await c.req.json()) as { username?: string; password?: string };
	if (username !== ADMIN_USER || password !== ADMIN_PASS) {
		return c.json({ error: '用户名或密码错误' }, 401);
	}
	setCookie(c, 'bonsai_session', issueSession(), {
		httpOnly: true,
		sameSite: 'Lax',
		secure: true,
		path: '/',
		maxAge: 30 * 86_400,
	});
	return c.json({ ok: true, user: ADMIN_USER });
});

app.post('/api/logout', (c) => {
	deleteCookie(c, 'bonsai_session', { path: '/' });
	return c.json({ ok: true });
});

app.get('/api/session', (c) => c.json({ ok: true, user: ADMIN_USER }));

// ---- status / config ---------------------------------------------------
app.get('/api/status', async (c) => {
	const cfg = await getConfig();
	return c.json({
		repo: cfg.repo,
		github: {
			configured: !!ghClientId(),
			connected: !!cfg.github.login || !!cfg.github.token || !!process.env.GITHUB_TOKEN,
			login: cfg.github.login,
			tokenSource: cfg.github.token ? 'oauth' : process.env.GITHUB_TOKEN ? 'token' : 'app',
		},
		pager: { pagerduty: !!process.env.PAGER_ROUTING_KEY, webhook: !!process.env.PAGER_WEBHOOK_URL },
		model: process.env.KEEPER_MODEL ?? 'cloudflare/@cf/moonshotai/kimi-k2.6',
		schedules: ['0 0 * * *', '0 */6 * * *'],
	});
});

app.get('/api/config', async (c) => {
	const cfg = await getConfig();
	return c.json({ ...cfg, github: { login: cfg.github.login, connected: !!cfg.github.login } });
});

app.put('/api/config', async (c) => {
	const patch = (await c.req.json()) as Record<string, unknown>;
	const next = await setConfig(patch);
	return c.json({ ...next, github: { login: next.github.login, connected: !!next.github.login } });
});

// ---- runs --------------------------------------------------------------
app.post('/api/run', async (c) => {
	const { slot } = (await c.req.json()) as { slot?: 'daily' | 'quick' };
	const cfg = await getConfig();
	const s = slot === 'quick' ? cfg.quick : cfg.daily;
	const receipt = await dispatch(Keeper, {
		id: CONVERSATION_ID,
		message: {
			kind: 'signal',
			type: 'schedule',
			body: cfg.extra ? `${s.task}\n\n附加指令:\n${cfg.extra}` : s.task,
			attributes: { cron: slot === 'quick' ? 'manual-quick' : 'manual-daily', scheduledAt: new Date().toISOString() },
		},
	});
	return c.json(receipt, 202);
});

// ---- github connect ----------------------------------------------------
app.get('/api/github/status', async (c) => {
	const cfg = await getConfig();
	const source = cfg.github.token ? 'oauth' : process.env.GITHUB_TOKEN ? 'token' : '';
	return c.json({
		configured: !!ghClientId(),
		connected: !!cfg.github.login || !!source,
		login: cfg.github.login || '',
		source: cfg.github.token ? 'oauth' : process.env.GITHUB_TOKEN ? 'token' : '',
	});
});

app.post('/api/github/connect', async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { token?: string };
	// Option 1: connect with a Personal Access Token pasted from the UI.
	if (body.token) {
		const res = await fetch('https://api.github.com/user', {
			headers: {
				authorization: `Bearer ${body.token}`,
				accept: 'application/vnd.github+json',
				'user-agent': 'bonsai',
			},
		});
		if (!res.ok) return c.json({ error: 'Token 无效或权限不足' }, 400);
		const user = (await res.json()) as { login?: string };
		await setConfig({ github: { token: body.token.trim(), login: user.login ?? '' } });
		return c.json({ connected: true, login: user.login ?? '' });
	}
	// Option 2: OAuth popup flow.
	if (!ghClientId()) {
		return c.json({
			error: '未配置 GitHub OAuth App，可在下方直接粘贴 Personal Access Token 连接',
		}, 400);
	}
	const url =
		'https://github.com/login/oauth/authorize' +
		`?client_id=${ghClientId()}` +
		`&redirect_uri=${encodeURIComponent('https://celadon.chat/api/github/callback')}` +
		'&scope=repo%20read:user' +
		`&state=${ghState()}`;
	return c.json({ url });
});

app.get('/api/github/callback', async (c) => {
	const code = c.req.query('code') ?? '';
	const state = c.req.query('state') ?? '';
	if (!code || !ghStateValid(state)) return c.html('<p style="font-family:system-ui">授权失败：state 无效</p>', 400);
	const res = await fetch('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/vnd.github+json' },
		body: JSON.stringify({
			client_id: ghClientId(),
			client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
			code,
		}),
	});
	const data = (await res.json()) as { access_token?: string };
	if (!data.access_token) return c.html('<p style="font-family:system-ui">授权失败：未取得 access_token</p>', 400);
	const user = (await (
		await fetch('https://api.github.com/user', {
			headers: {
				authorization: `Bearer ${data.access_token}`,
				accept: 'application/vnd.github+json',
				'user-agent': 'bonsai',
			},
		})
	).json()) as { login?: string };
	await setConfig({ github: { token: data.access_token, login: user.login ?? '' } });
	return c.html(CALLBACK_HTML);
});

app.get('/api/github/repos', async (c) => {
	const cfg = await getConfig();
	const token = cfg.github.token || process.env.GITHUB_TOKEN;
	if (!token) return c.json({ error: '未连接 GitHub' }, 400);
	const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'user-agent': 'bonsai',
		},
	});
	if (!res.ok) return c.json({ error: `GitHub ${res.status}` }, 502);
	const repos = (await res.json()) as Array<{ full_name: string; private: boolean }>;
	return c.json({ repos: repos.map((r) => ({ name: r.full_name, private: r.private })) });
});

// ---- agents + UI -------------------------------------------------------
app.route('/agents/keeper', createAgentRouter(Keeper));

// 版本号跳转：每次部署 URL 都变，强制任何浏览器缓存失效。
const UI_VERSION = createHash('sha256').update(UI_HTML).digest('hex').slice(0, 8);

app.get('/', (c) => c.redirect(`/ui?v=${UI_VERSION}`, 302));

app.get('/ui', (c) => {
	c.header('Cache-Control', 'no-store');
	return c.html(UI_HTML);
});

app.get('/*', (c) => {
	c.header('Cache-Control', 'no-store');
	return c.html(UI_HTML);
});

export default app;
