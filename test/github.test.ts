import { generateKeyPairSync, createPublicKey, verify as rsaVerify } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { appJwt } from '../src/tools/repo.ts';

test('appJwt is a verifiable RS256 GitHub App JWT with iss/iat/exp claims', () => {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	const now = 1_700_000_000;
	const jwt = appJwt('123456', privateKey as string, now);

	const [h, p, s] = jwt.split('.');
	const ok = rsaVerify(
		'sha256',
		Buffer.from(`${h}.${p}`),
		createPublicKey(publicKey as string),
		Buffer.from(s, 'base64url'),
	);
	assert.equal(ok, true);

	const header = JSON.parse(Buffer.from(h, 'base64url').toString());
	assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });

	const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
	assert.equal(claims.iss, '123456');
	assert.equal(claims.iat, now - 60);
	assert.equal(claims.exp, now + 540);
});
