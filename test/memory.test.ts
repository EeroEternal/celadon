import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMemorySeed } from '../src/config.ts';

test('parseMemorySeed falls back to empty on missing or junk input', () => {
	assert.deepEqual(parseMemorySeed(undefined), { entries: [], nextId: 1 });
	assert.deepEqual(parseMemorySeed('junk'), { entries: [], nextId: 1 });
	assert.deepEqual(parseMemorySeed([{ id: 1, kind: 'nope', note: 'x', at: 't' }]), { entries: [], nextId: 1 });
});

test('parseMemorySeed keeps valid entries and numbers the next id after the max', () => {
	const { entries, nextId } = parseMemorySeed([
		{ id: 2, kind: 'fact', note: 'a', at: 't1' },
		{ id: 7, kind: 'action', note: 'b', at: 't2' },
	]);
	assert.equal(entries.length, 2);
	assert.equal(nextId, 8);
});

test('parseMemorySeed caps the snapshot at 200 entries', () => {
	const many = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, kind: 'fact', note: `n${i}`, at: 't' }));
	const { entries, nextId } = parseMemorySeed(many);
	assert.equal(entries.length, 200);
	assert.equal(entries[0].id, 51);
	assert.equal(nextId, 251);
});
