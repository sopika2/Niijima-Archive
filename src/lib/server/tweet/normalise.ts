/**
 * Reads the two public tweet APIs into one shape. FxTwitter (api.fxtwitter.com/status/<id>)
 * answers { code, message, tweet: {…} }; vxTwitter (api.vxtwitter.com/Twitter/status/<id>)
 * answers a flat object, or an HTML page when it can't find the tweet. Anything unexpected
 * becomes a TweetParseError with a readable reason, never a half-filled tweet.
 */

export type MediaKind = 'image' | 'gif' | 'video';

export interface NormalMedia {
	readonly kind: MediaKind;
	/** The file to download: the original photo, or the best MP4. */
	readonly url: string;
	/** For videos: every MP4, best first, so a smaller one can be picked when the best is too big. */
	readonly variants: ReadonlyArray<{ readonly url: string; readonly bitrate: number }>;
	/** A still frame for videos and GIFs. */
	readonly thumbnailUrl: string | null;
	readonly width: number | null;
	readonly height: number | null;
	readonly durationMs: number | null;
	readonly alt: string | null;
}

export interface NormalQuote {
	readonly url: string;
	readonly text: string;
	readonly authorName: string;
	readonly authorHandle: string;
}

export interface NormalTweet {
	readonly id: string;
	/** https://x.com/<handle>/status/<id> */
	readonly url: string;
	readonly text: string;
	readonly authorName: string;
	readonly authorHandle: string;
	/** ISO 8601, or null when the API didn't say. */
	readonly postedAt: string | null;
	readonly media: readonly NormalMedia[];
	readonly quote: NormalQuote | null;
	readonly source: 'fxtwitter' | 'vxtwitter';
}

export class TweetParseError extends Error {
	override readonly name = 'TweetParseError';
	/** True when the API says the tweet doesn't exist (deleted, private, suspended). */
	readonly missing: boolean;
	constructor(message: string, missing = false) {
		super(message);
		this.missing = missing;
	}
}

/** The only hosts tweet files are ever downloaded from. */
export const MEDIA_HOSTS = new Set(['pbs.twimg.com', 'video.twimg.com']);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() !== '' ? value : null;
const num = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Parses the response body, which may not be JSON at all. */
export function parseBody(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		throw new TweetParseError(
			/<html/i.test(body)
				? 'The API answered with a web page, not the tweet.'
				: 'The API answer was not JSON.',
			/Failed to scan your link|doesn't exist/i.test(body)
		);
	}
}

/** The old Twitter API escaped these three; the text is shown as text, so undo it. */
function decodeEntities(text: string): string {
	return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** A media URL on an allowed host over https, or null. */
function mediaUrl(value: unknown): string | null {
	const text = str(value);
	if (!text) return null;
	try {
		const url = new URL(text);
		return url.protocol === 'https:' && MEDIA_HOSTS.has(url.hostname) ? url.toString() : null;
	} catch {
		return null;
	}
}

/** Photos at their original size. */
function originalPhoto(url: string): string {
	const parsed = new URL(url);
	if (parsed.hostname === 'pbs.twimg.com' && parsed.pathname.startsWith('/media/')) {
		parsed.searchParams.set('name', 'orig');
	}
	return parsed.toString();
}

function isoFrom(epochSeconds: unknown, text: unknown): string | null {
	const seconds = num(epochSeconds);
	if (seconds !== null && seconds > 0) return new Date(seconds * 1000).toISOString();
	const parsed = Date.parse(str(text) ?? '');
	return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function canonicalUrl(id: string, handle: string): string {
	return `https://x.com/${handle || 'i'}/status/${id}`;
}

/** MP4 variants, best (highest bitrate) first. */
function mp4Variants(item: Json): Array<{ url: string; bitrate: number }> {
	const seen = new Set<string>();
	const out: Array<{ url: string; bitrate: number }> = [];
	for (const variant of [...list(item.variants), ...list(item.formats)]) {
		if (!isObject(variant)) continue;
		const type =
			str(variant.content_type) ?? (str(variant.container) === 'mp4' ? 'video/mp4' : null);
		const url = mediaUrl(variant.url);
		if (type !== 'video/mp4' || !url || seen.has(url)) continue;
		seen.add(url);
		out.push({ url, bitrate: num(variant.bitrate) ?? 0 });
	}
	return out.sort((a, b) => b.bitrate - a.bitrate);
}

// ── FxTwitter ────────────────────────────────────────────────────────────────

export function fromFxTwitter(data: unknown): NormalTweet {
	if (!isObject(data)) throw new TweetParseError('FxTwitter sent something that is not a tweet.');
	const code = num(data.code);
	if (code !== 200 || !isObject(data.tweet)) {
		const message = str(data.message) ?? 'unknown error';
		throw new TweetParseError(
			`FxTwitter: ${message} (${code ?? '?'})`,
			code === 404 || code === 401 || message === 'NOT_FOUND' || message === 'PRIVATE_TWEET'
		);
	}
	return fxTweet(data.tweet);
}

function fxTweet(tweet: Json): NormalTweet {
	const id = str(tweet.id);
	const author = isObject(tweet.author) ? tweet.author : {};
	const handle = str(author.screen_name);
	if (!id || !handle) throw new TweetParseError('FxTwitter left out the tweet id or author.');
	const all = isObject(tweet.media) ? list(tweet.media.all) : [];
	const media: NormalMedia[] = [];
	for (const item of all) {
		if (!isObject(item)) continue;
		const type = str(item.type);
		if (type === 'photo') {
			const url = mediaUrl(item.url);
			if (!url) continue;
			media.push({
				kind: 'image',
				url: originalPhoto(url),
				variants: [],
				thumbnailUrl: null,
				width: num(item.width),
				height: num(item.height),
				durationMs: null,
				alt: str(item.altText)
			});
		} else if (type === 'video' || type === 'gif') {
			const variants = mp4Variants(item);
			const url = mediaUrl(item.url) ?? variants[0]?.url;
			if (!url) continue;
			const duration = num(item.duration);
			media.push({
				kind: type === 'gif' ? 'gif' : 'video',
				url,
				variants: variants.length > 0 ? variants : [{ url, bitrate: 0 }],
				thumbnailUrl: mediaUrl(item.thumbnail_url),
				width: num(item.width),
				height: num(item.height),
				durationMs: duration && duration > 0 ? Math.round(duration * 1000) : null,
				alt: str(item.altText)
			});
		}
	}
	let quote: NormalQuote | null = null;
	if (isObject(tweet.quote)) {
		const q = tweet.quote;
		const qa = isObject(q.author) ? q.author : {};
		const qid = str(q.id);
		const qhandle = str(qa.screen_name) ?? '';
		if (qid) {
			quote = {
				url: canonicalUrl(qid, qhandle),
				text: decodeEntities(typeof q.text === 'string' ? q.text : ''),
				authorName: str(qa.name) ?? qhandle,
				authorHandle: qhandle
			};
		}
	}
	return {
		id,
		url: canonicalUrl(id, handle),
		text: decodeEntities(typeof tweet.text === 'string' ? tweet.text : ''),
		authorName: str(author.name) ?? handle,
		authorHandle: handle,
		postedAt: isoFrom(tweet.created_timestamp, tweet.created_at),
		media,
		quote,
		source: 'fxtwitter'
	};
}

// ── vxTwitter ────────────────────────────────────────────────────────────────

export function fromVxTwitter(data: unknown): NormalTweet {
	if (!isObject(data)) throw new TweetParseError('vxTwitter sent something that is not a tweet.');
	if (str(data.error)) throw new TweetParseError(`vxTwitter: ${str(data.error)}`, true);
	const id = str(data.tweetID);
	const handle = str(data.user_screen_name);
	if (!id || !handle) throw new TweetParseError('vxTwitter left out the tweet id or author.');

	const media: NormalMedia[] = [];
	const extended = list(data.media_extended);
	const items =
		extended.length > 0
			? extended
			: list(data.mediaURLs).map((url) => ({ url, type: guessType(url) }));
	for (const item of items) {
		if (!isObject(item)) continue;
		const url = mediaUrl(item.url);
		if (!url) continue;
		const size = isObject(item.size) ? item.size : {};
		const type = str(item.type);
		const kind: MediaKind = type === 'gif' ? 'gif' : type === 'video' ? 'video' : 'image';
		const duration = num(item.duration_millis);
		media.push({
			kind,
			url: kind === 'image' ? originalPhoto(url) : url,
			variants: kind === 'image' ? [] : [{ url, bitrate: 0 }],
			thumbnailUrl: kind === 'image' ? null : mediaUrl(item.thumbnail_url),
			width: num(size.width),
			height: num(size.height),
			durationMs: duration && duration > 0 ? duration : null,
			alt: str(item.altText)
		});
	}

	let text = decodeEntities(typeof data.text === 'string' ? data.text : '');
	// vxTwitter leaves the t.co link to the attached media (or quote) on the end.
	if (media.length > 0 || data.qrtURL) text = text.replace(/(\s*https?:\/\/t\.co\/\w+)+\s*$/, '');

	let quote: NormalQuote | null = null;
	if (isObject(data.qrt)) {
		const q = data.qrt;
		const qid = str(q.tweetID);
		const qhandle = str(q.user_screen_name) ?? '';
		if (qid) {
			quote = {
				url: canonicalUrl(qid, qhandle),
				text: decodeEntities(typeof q.text === 'string' ? q.text : '').replace(
					/(\s*https?:\/\/t\.co\/\w+)+\s*$/,
					''
				),
				authorName: str(q.user_name) ?? qhandle,
				authorHandle: qhandle
			};
		}
	}

	return {
		id,
		url: canonicalUrl(id, handle),
		text,
		authorName: str(data.user_name) ?? handle,
		authorHandle: handle,
		postedAt: isoFrom(data.date_epoch, data.date),
		media,
		quote,
		source: 'vxtwitter'
	};
}

function guessType(url: unknown): string {
	return typeof url === 'string' && url.includes('video.twimg.com') ? 'video' : 'image';
}

/**
 * The MP4 to download: the best one whose estimated size fits `maxBytes`, else the smallest.
 * Variants without a bitrate (GIFs, vxTwitter) are taken as they are.
 */
export function pickVariant(item: NormalMedia, maxBytes: number): string {
	if (item.kind === 'image' || item.variants.length === 0) return item.url;
	const seconds = (item.durationMs ?? 0) / 1000;
	const fits = item.variants.find(
		(variant) =>
			variant.bitrate === 0 || seconds === 0 || (variant.bitrate * seconds * 1.1) / 8 <= maxBytes
	);
	return (fits ?? item.variants[item.variants.length - 1]!).url;
}
