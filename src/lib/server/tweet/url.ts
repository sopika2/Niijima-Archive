/**
 * Tweet links in any of the shapes people paste or share: x.com, twitter.com, mobile., www.,
 * the embed fixers (fxtwitter, vxtwitter, fixupx, fixvx), /i/web/status/…, with /photo/1 or
 * ?s=20 tracking on the end, or buried in shared text ("Look at this https://x.com/…").
 */
const HOSTS = new Set([
	'x.com',
	'twitter.com',
	'mobile.twitter.com',
	'mobile.x.com',
	'fxtwitter.com',
	'vxtwitter.com',
	'fixupx.com',
	'fixvx.com',
	'nitter.net'
]);

export interface TweetRef {
	readonly id: string;
	/** The handle in the link, when there is one (not for /i/web/status/…). */
	readonly handle: string | null;
	/** https://x.com/<handle>/status/<id> */
	readonly url: string;
}

export function parseTweetUrl(input: string): TweetRef | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	if (!HOSTS.has(host)) return null;
	const parts = url.pathname.split('/').filter(Boolean);
	const at = parts.findIndex((part) => part === 'status' || part === 'statuses');
	if (at < 0) return null;
	const id = parts[at + 1];
	if (!id || !/^\d{1,20}$/.test(id)) return null;
	const before = parts.slice(0, at);
	const handle =
		before.length === 1 && /^\w{1,15}$/.test(before[0]!) && before[0] !== 'i' ? before[0]! : null;
	return { id, handle, url: `https://x.com/${handle ?? 'i'}/status/${id}` };
}

/** The first tweet link anywhere in a piece of text (what the share sheet hands over). */
export function findTweetUrl(...texts: Array<string | null | undefined>): TweetRef | null {
	for (const text of texts) {
		for (const candidate of (text ?? '').match(/https?:\/\/[^\s<>"']+/g) ?? []) {
			const ref = parseTweetUrl(candidate);
			if (ref) return ref;
		}
	}
	return null;
}

/** The first web address in a piece of text, tweet or not. */
export function findUrl(...texts: Array<string | null | undefined>): string | null {
	for (const text of texts) {
		const match = (text ?? '').match(/https?:\/\/[^\s<>"']+/);
		if (match) return match[0];
	}
	return null;
}
