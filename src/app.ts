import { dispatch } from '@flue/runtime';
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Keeper } from './agents/keeper.ts';
import { getConfig, setConfig } from './config.ts';
import { UI_HTML } from './ui.ts';

const app = new Hono();

app.get('/', (c) => c.html(UI_HTML));
app.get('/health', (c) => c.json({ ok: true }));

// Public domain (celadon.chat): agent + admin API require a bearer key, fail closed.
const guard = async (c: any, next: () => Promise<void>) => {
	const key = process.env.KEEPER_API_KEY;
	if (!key) return c.json({ error: 'KEEPER_API_KEY is not set' }, 503);
	if (c.req.header('authorization') !== `Bearer ${key}`) return c.json({ error: 'unauthorized' }, 401);
	await next();
};
app.use('/agents/*', guard);
app.use('/api/*', guard);

app.get('/api/config', async (c) => c.json(await getConfig()));
app.put('/api/config', async (c) => c.json(await setConfig(await c.req.json())));

app.post('/api/run', async (c) => {
	const { slot } = (await c.req.json()) as { slot?: 'daily' | 'quick' };
	const cfg = await getConfig();
	const s = slot === 'quick' ? cfg.quick : cfg.daily;
	const receipt = await dispatch(Keeper, {
		id: 'nightly',
		message: {
			kind: 'signal',
			type: 'schedule',
			body: cfg.extra ? `${s.task}\n\n附加指令:\n${cfg.extra}` : s.task,
			attributes: { cron: slot === 'quick' ? 'manual-quick' : 'manual-daily', scheduledAt: new Date().toISOString() },
		},
	});
	return c.json(receipt, 202);
});

app.route('/agents/keeper', createAgentRouter(Keeper));

export default app;
