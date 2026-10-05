import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Keeper } from './agents/keeper.ts';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

// ponytail: no auth on the mount yet — add your own middleware before exposing it publicly.
app.route('/agents/keeper', createAgentRouter(Keeper));

export default app;
