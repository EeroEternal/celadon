// Fetch a URL handed to the agent ("temp link"): GET text content with a hard
// byte cap. This is what makes the runner general — tasks can deliver code or
// docs as a link instead of through the linked repository.
//
// SSRF guard: http(s) only; localhost, link-local/metadata and private
// ranges are refused (Workers usually cannot reach them anyway, but the tool
// takes URLs straight from chat, so refuse them explicitly).

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 15_000;

const BLOCKED_HOSTS = new Set([
	'localhost',
	'127.0.0.1',
	'0.0.0.0',
	'::1',
	'[::1]',
	'169.254.169.254', // cloud metadata
	'metadata.google.internal',
	'metadata.goog',
]);

/** Return the normalized URL when it is safe to fetch, otherwise null. */
export function isFetchableUrl(raw: string): string | null {
	let u: URL;
	try {
		u = new URL(String(raw ?? '').trim());
	} catch {
		return null;
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
	const h = u.hostname.toLowerCase();
	if (BLOCKED_HOSTS.has(h)) return null;
	if (/^10\./.test(h) || /^127\./.test(h) || /^192\.168\./.test(h)) return null;
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
	if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return null;
	if (/^\[?(fc|fd|fe80)/.test(h)) return null;
	return u.href;
}

/** GET a URL and return its text. Binary responses are reported as metadata. */
export async function fetchText(raw: string): Promise<string> {
	const target = isFetchableUrl(raw);
	if (!target) throw new Error('unsupported URL — only http/https, no localhost or private addresses');
	const res = await fetch(target, {
		redirect: 'follow',
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { 'user-agent': 'celadon' },
	});
	if (!res.ok) throw new Error(`fetch ${target} -> ${res.status} ${res.statusText}`);
	const type = res.headers.get('content-type') || '';
	const buf = new Uint8Array(await res.arrayBuffer());
	const truncated = buf.byteLength > MAX_BYTES;
	const clipped = truncated ? buf.subarray(0, MAX_BYTES) : buf;
	const isText = type === '' || /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|ld\+json)|[^;]+; *charset=)/i.test(type);
	if (!isText) return `[binary content: ${type || 'unknown'}, ${buf.byteLength} bytes — nothing textual to return]`;
	const text = new TextDecoder('utf-8').decode(clipped);
	return truncated ? `${text}\n...[truncated at ${MAX_BYTES} bytes]` : text;
}
