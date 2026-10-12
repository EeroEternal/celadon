import assert from 'node:assert/strict';
import test from 'node:test';
import { isFetchableUrl } from '../src/tools/fetch.ts';

test('fetchable: plain http(s) urls pass', () => {
	assert.equal(isFetchableUrl('https://mentora.pub/docs/guide.md'), 'https://mentora.pub/docs/guide.md');
	assert.equal(isFetchableUrl('  http://example.com/a?b=1  '), 'http://example.com/a?b=1');
});

test('refused: non-http schemes', () => {
	assert.equal(isFetchableUrl('file:///etc/passwd'), null);
	assert.equal(isFetchableUrl('ftp://example.com/x'), null);
	assert.equal(isFetchableUrl('not a url'), null);
	assert.equal(isFetchableUrl(''), null);
});

test('refused: localhost, link-local metadata and private ranges', () => {
	assert.equal(isFetchableUrl('http://localhost:8787/secret'), null);
	assert.equal(isFetchableUrl('http://127.0.0.1/admin'), null);
	assert.equal(isFetchableUrl('http://169.254.169.254/latest/meta-data'), null);
	assert.equal(isFetchableUrl('http://10.0.0.5/x'), null);
	assert.equal(isFetchableUrl('http://172.16.0.1/x'), null);
	assert.equal(isFetchableUrl('http://192.168.1.1/x'), null);
	assert.equal(isFetchableUrl('http://100.64.0.1/x'), null);
	assert.equal(isFetchableUrl('http://[fd00::1]/x'), null);
});

test('allowed: public addresses inside the overlapping ranges', () => {
	assert.equal(isFetchableUrl('http://172.15.0.1/x'), 'http://172.15.0.1/x');
	assert.equal(isFetchableUrl('http://172.32.0.1/x'), 'http://172.32.0.1/x');
	assert.equal(isFetchableUrl('http://11.0.0.1/x'), 'http://11.0.0.1/x');
	assert.equal(isFetchableUrl('https://api.github.com/'), 'https://api.github.com/');
});
