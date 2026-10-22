import type { Db } from './db/client.ts';
import {
	addMedia,
	createItem,
	deleteItems,
	findTweet,
	getItemRow,
	ignoreZipline,
	mediaOf,
	recordFetchFailure,
	recordTweet,
	updateMedia
} from './db/items.ts';
import type { MediaRow, Owner } from './db/schema.ts';
import type { Scope } from './db/scope.ts';
import type { SavedFile, Storage } from './media/storage.ts';
import { MediaRejected } from './media/store.ts';
import { describeFetchError, safeFetch, type FetchLike } from './safe-fetch.ts';
import { fetchTweet } from './tweet/client.ts';
import { MEDIA_HOSTS, pickVariant, type NormalMedia } from './tweet/normalise.ts';
import type { TweetRef } from './tweet/url.ts';

/** What saving needs: the database, the files, the limits. Tests pass their own. */
export interface SaveServices {
	readonly db: Db;
	readonly store: Storage;
	readonly maxUploadBytes: number;
	readonly maxTweetMediaBytes: number;
	readonly timeoutMs: number;
	readonly fetchImpl?: FetchLike;
	readonly log?: (message: string) => void;
}

export interface Placement {
	readonly owner: Owner;
	readonly collectionId: string | null;
	readonly caption: string;
	readonly tags: string | readonly string[];
}

export interface TweetSaved {
	readonly id: string;
	/** It was already in the Den; nothing new was saved. */
	readonly duplicate: boolean;
	/** Whether the tweet could be read. When not, the link and caption are kept for a retry. */
	readonly fetched: boolean;
	readonly error: string | null;
}

/**
 * Saves a tweet: the link and her caption at once, then the text, author, date and every photo
 * or video, downloaded to disk so they outlive the tweet. A failed fetch still keeps the link.
 */
export async function saveTweet(
	services: SaveServices,
	ref: TweetRef,
	placement: Placement,
	scope: Scope | null
): Promise<TweetSaved> {
	const existing = findTweet(services.db, ref.id, scope);
	if (existing)
		return { id: existing.id, duplicate: true, fetched: existing.fetchState === 'ok', error: null };
	const id = createItem(services.db, {
		kind: 'tweet',
		...placement,
		tweetId: ref.id,
		tweetUrl: ref.url,
		fetchState: 'failed'
	});
	const result = await fetchInto(services, id);
	return { id, duplicate: false, ...result };
}

/** Reads the tweet again and downloads whatever files are still missing ("retry fetch"). */
export async function fetchInto(
	services: SaveServices,
	itemId: string
): Promise<{ fetched: boolean; error: string | null }> {
	const { db } = services;
	const item = getItemRow(db, itemId);
	if (!item?.tweetId) return { fetched: false, error: 'Not a tweet.' };
	let tweet;
	try {
		tweet = await fetchTweet(item.tweetId, {
			timeoutMs: services.timeoutMs,
			fetchImpl: services.fetchImpl
		});
	} catch (error) {
		const reason = describeFetchError(error);
		recordFetchFailure(db, itemId, reason);
		services.log?.(`tweet ${item.tweetId}: ${reason}`);
		return { fetched: false, error: reason };
	}
	recordTweet(db, itemId, {
		tweetUrl: tweet.url,
		tweetText: tweet.text,
		authorName: tweet.authorName,
		authorHandle: tweet.authorHandle,
		postedAt: tweet.postedAt,
		quote: tweet.quote
	});

	let rows = mediaOf(db, itemId);
	if (rows.length === 0 && tweet.media.length > 0) {
		tweet.media.forEach((file, position) =>
			addMedia(db, {
				itemId,
				position,
				kind: file.kind,
				width: file.width,
				height: file.height,
				durationMs: file.durationMs,
				alt: file.alt,
				remoteUrl: pickVariant(file, services.maxTweetMediaBytes),
				posterUrl: file.thumbnailUrl
			})
		);
		rows = mediaOf(db, itemId);
	}
	const problems: string[] = [];
	for (const row of rows) {
		const fresh = tweet.media[row.position];
		if ((row.path || row.ziplineId) && (row.thumbPath || row.kind === 'image')) continue;
		try {
			await download(services, row, fresh);
		} catch (error) {
			problems.push(describeFetchError(error));
		}
	}
	if (problems.length > 0) services.log?.(`tweet ${item.tweetId}: ${problems.join('; ')}`);
	return {
		fetched: true,
		error: problems.length > 0 ? `Some files didn't download: ${problems[0]}` : null
	};
}

async function download(
	services: SaveServices,
	row: MediaRow,
	fresh: NormalMedia | undefined
): Promise<void> {
	const options = {
		allowedHosts: MEDIA_HOSTS,
		timeoutMs: Math.max(services.timeoutMs, 60_000),
		maxBytes: services.maxTweetMediaBytes,
		fetchImpl: services.fetchImpl
	};
	const remote = fresh ? pickVariant(fresh, services.maxTweetMediaBytes) : row.remoteUrl;
	const poster = fresh?.thumbnailUrl ?? row.posterUrl;
	if (!row.path && !row.ziplineId && remote) {
		let response;
		try {
			response = await safeFetch(remote, options);
		} catch (error) {
			// An original photo can be huge; Twitter's "large" size is a fine second choice.
			if (row.kind !== 'image' || !remote.includes('name=orig')) throw error;
			response = await safeFetch(remote.replace('name=orig', 'name=large'), options);
		}
		if (response.status !== 200)
			throw new Error(`${new URL(remote).hostname} answered ${response.status}.`);
		const stored = await services.store.save(response.body, {
			id: row.id,
			maxBytes: services.maxTweetMediaBytes
		});
		updateMedia(services.db, row.id, {
			...where(stored),
			thumbPath: stored.thumbPath,
			mime: stored.mime,
			bytes: stored.bytes,
			width: stored.width ?? row.width,
			height: stored.height ?? row.height,
			remoteUrl: remote
		});
		row = { ...row, thumbPath: stored.thumbPath };
	}
	if (!row.thumbPath && poster) {
		const still = await safeFetch(poster, { ...options, maxBytes: 10_000_000 });
		if (still.status === 200) {
			const thumb = await services.store.saveThumb(still.body, row.id);
			updateMedia(services.db, row.id, { thumbPath: thumb.thumbPath, posterUrl: poster });
		}
	}
}

export interface Upload {
	readonly bytes: Buffer;
	/** A still frame the browser grabbed from a video, if any. */
	readonly poster?: Buffer | null;
	readonly sourceUrl?: string | null;
	readonly caption?: string;
}

/**
 * Saves one uploaded file as an image item (pictures, GIFs, short videos). Throws MediaRejected
 * before anything is written when the file isn't one the Archive keeps.
 */
export async function saveUpload(
	services: SaveServices,
	upload: Upload,
	placement: Omit<Placement, 'caption'>
): Promise<string> {
	const stored = await services.store.save(upload.bytes, { maxBytes: services.maxUploadBytes });
	let thumb: { thumbPath: string; width: number | null; height: number | null } | null = null;
	if (stored.kind === 'video' && upload.poster && upload.poster.length > 0) {
		try {
			thumb = await services.store.saveThumb(upload.poster, stored.id);
		} catch (error) {
			if (!(error instanceof MediaRejected)) throw error;
		}
	}
	const itemId = createItem(services.db, {
		kind: 'image',
		owner: placement.owner,
		collectionId: placement.collectionId,
		caption: upload.caption ?? '',
		tags: placement.tags,
		sourceUrl: cleanUrl(upload.sourceUrl)
	});
	addMedia(services.db, {
		id: stored.id,
		itemId,
		position: 0,
		kind: stored.kind,
		mime: stored.mime,
		...where(stored),
		thumbPath: stored.thumbPath ?? thumb?.thumbPath ?? null,
		width: stored.width ?? thumb?.width ?? null,
		height: stored.height ?? thumb?.height ?? null,
		bytes: stored.bytes
	});
	return itemId;
}

/** The columns that say where a saved file lives. */
function where(file: SavedFile) {
	return {
		path: file.path,
		ziplineId: file.ziplineId,
		ziplineName: file.ziplineName,
		mirrorUrl: file.mirrorUrl,
		keepLocal: file.keepLocal,
		storageNote: file.storageNote
	};
}

/**
 * Deletes items and their files on the Archive's disk. Their Zipline copies stay on Mementos
 * (and the sync won't bring them back) unless `alsoZipline` is set.
 */
export async function removeItems(
	services: Pick<SaveServices, 'db' | 'store'>,
	ids: readonly string[],
	scope: Scope | null,
	options: { alsoZipline?: boolean } = {}
): Promise<{ deleted: number; ziplineFailed: number }> {
	const { deleted, files, zipline } = deleteItems(services.db, ids, scope);
	ignoreZipline(services.db, zipline, options.alsoZipline ? 'deleted' : 'kept');
	const { ziplineFailed } = await services.store.remove(
		{ paths: files, zipline },
		options.alsoZipline ?? false
	);
	return { deleted, ziplineFailed };
}

/** A web address worth keeping as a source link (http or https), or null. */
export function cleanUrl(value: string | null | undefined): string | null {
	const text = (value ?? '').trim();
	if (!text) return null;
	try {
		const url = new URL(text);
		return url.protocol === 'https:' || url.protocol === 'http:'
			? url.toString().slice(0, 2000)
			: null;
	} catch {
		return null;
	}
}
