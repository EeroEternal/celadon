import assert from 'node:assert/strict';
import test from 'node:test';
import { pagerPayload } from '../src/tools/pager.ts';

test('pagerPayload maps critical severity and caps summary', () => {
	process.env.PAGER_ROUTING_KEY = 'routed';
	const long = 'x'.repeat(2000);
	const p = pagerPayload('critical', long, 'xgateway-keeper');
	assert.equal(p.event_action, 'trigger');
	assert.equal(p.payload.severity, 'critical');
	assert.equal(p.payload.summary.length, 1024);
	assert.equal(p.payload.source, 'xgateway-keeper');
	assert.equal(p.dedup_key.startsWith('keeper:xgateway-keeper:'), true);
});

test('pagerPayload downgrades non-critical to warning', () => {
	process.env.PAGER_ROUTING_KEY = '';
	const p = pagerPayload('info', 'slow query', 'xgateway-keeper');
	assert.equal(p.payload.severity, 'warning');
	assert.equal(p.routing_key, '');
});
