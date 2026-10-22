import { and, asc, desc, eq, exists, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ItemView, MediaView } from '$lib/types.ts';
import type { Db } from './client.ts';
import {
	collections,
	itemTags,
	items,
	media,
	type FetchState,
	type ItemKind,
	type ItemRow,
	type MediaKind,
	type MediaRow,
	type Owner,
	type QuotedTweet,
	ziplineIgnored
} from './schema.ts';
import { ownedBy, type Scope } from './scope.ts';
import { ftsQuery } from './search.ts';
import { normaliseTags } from './tags.ts';

export interface ItemFilter {
	readonly scope?: Scope | null;
	/** A collection id, or "none" for the unsorted ones. */
	readonly collectionId?: string | null;
	readonly tag?: string | null;
	readonly kind?: ItemKind | null;
	/** Words to search for in captions, tweet text, authors and tags. */
	readonly q?: string | null;
}

export interface ItemPage {
	readonly items: ItemView[];
	/** Pass back as `cursor` for the next page; null on the last one. */
	readonly next: string | null;
}

/** Where a stored file is served from. */
export const mediaUrl = (path: string | null) => (path ? `/media/${path}` : null);

function encodeCursor(row: Pick<ItemRow, 'createdAt' | 'id'>): string {
	return Buffer.from(`${row.createdAt}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
	if (!cursor) return null;
	const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
	return createdAt && id ? { createdAt, id } : null;
}

function where(db: Db, filter: ItemFilter): SQL | undefined {
	const match = ftsQuery(filter.q);
	return and(
		ownedBy(items.owner, filter.scope),
		filter.kind ? eq(items.kind, filter.kind) : undefined,
		filter.collectionId === 'none'
			? isNull(items.collectionId)
			: filter.collectionId
				? eq(items.collectionId, filter.collectionId)
				: undefined,
		filter.tag
			? exists(
					db
						.select({ one: sql`1` })
						.from(itemTags)
						.where(and(eq(itemTags.itemId, items.id), eq(itemTags.tag, filter.tag)))
				)
			: undefined,
		match
			? sql`${items.id} IN (SELECT item_id FROM items_fts WHERE items_fts MATCH ${match})`
			: undefined
	);
}

/** Newest first, `limit` at a time. */
export function listItems(
	db: Db,
	filter: ItemFilter,
	page: { cursor?: string | null; limit: number }
): ItemPage {
	const cursor = decodeCursor(page.cursor);
	const rows = db
		.select({ item: items, collectionName: collections.name })
		.from(items)
		.leftJoin(collections, eq(items.collectionId, collections.id))
		.where(
			and(
				where(db, filter),
				cursor
					? or(
							lt(items.createdAt, cursor.createdAt),
							and(eq(items.createdAt, cursor.createdAt), lt(items.id, cursor.id))
						)
					: undefined
			)
		)
		.orderBy(desc(items.createdAt), desc(items.id))
		.limit(page.limit + 1)
		.all();
	const more = rows.length > page.limit;
	const shown = more ? rows.slice(0, page.limit) : rows;
	const views = toViews(
		db,
		shown.map((row) => ({ ...row.item, collectionName: row.collectionName }))
	);
	return { items: views, next: more ? encodeCursor(shown[shown.length - 1]!.item) : null };
}

export function countItems(db: Db, filter: ItemFilter): number {
	const row = db
		.select({ n: sql<number>`count(*)` })
		.from(items)
		.where(where(db, filter))
		.get();
	return row?.n ?? 0;
}

export function getItem(db: Db, id: string, scope?: Scope | null): ItemView | null {
	const row = db
		.select({ item: items, collectionName: collections.name })
		.from(items)
		.leftJoin(collections, eq(items.collectionId, collections.id))
		.where(and(eq(items.id, id), ownedBy(items.owner, scope)))
		.get();
	if (!row) return null;
	return toViews(db, [{ ...row.item, collectionName: row.collectionName }])[0] ?? null;
}

export function getItemRow(db: Db, id: string, scope?: Scope | null): ItemRow | null {
	return (
		db
			.select()
			.from(items)
			.where(and(eq(items.id, id), ownedBy(items.owner, scope)))
			.get() ?? null
	);
}

export function mediaOf(db: Db, itemId: string): MediaRow[] {
	return db.select().from(media).where(eq(media.itemId, itemId)).orderBy(asc(media.position)).all();
}

export function getMedia(db: Db, mediaId: string, scope?: Scope | null): MediaRow | null {
	const row = db
		.select({ media })
		.from(media)
		.innerJoin(items, eq(media.itemId, items.id))
		.where(and(eq(media.id, mediaId), ownedBy(items.owner, scope)))
		.get();
	return row?.media ?? null;
}

/** An existing item for this tweet that the scope can see. */
export function findTweet(db: Db, tweetId: string, scope?: Scope | null): ItemRow | null {
	return (
		db
			.select()
			.from(items)
			.where(and(eq(items.tweetId, tweetId), ownedBy(items.owner, scope)))
			.get() ?? null
	);
}

function toViews(db: Db, rows: Array<ItemRow & { collectionName: string | null }>): ItemView[] {
	if (rows.length === 0) return [];
	const ids = rows.map((row) => row.id);
	const files = db
		.select()
		.from(media)
		.where(inArray(media.itemId, ids))
		.orderBy(asc(media.itemId), asc(media.position))
		.all();
	const tags = db.select().from(itemTags).where(inArray(itemTags.itemId, ids)).all();
	return rows.map((row) => {
		const own = files.filter((file) => file.itemId === row.id).map(mediaView);
		const missing = files.some((file) => file.itemId === row.id && !file.path && !file.ziplineId);
		return {
			id: row.id,
			kind: row.kind,
			owner: row.owner,
			caption: row.caption,
			tags: tags
				.filter((tag) => tag.itemId === row.id)
				.map((tag) => tag.tag)
				.sort(),
			sourceUrl: row.sourceUrl,
			collection:
				row.collectionId && row.collectionName
					? { id: row.collectionId, name: row.collectionName }
					: null,
			tweet:
				row.kind === 'tweet' && row.tweetId
					? {
							id: row.tweetId,
							url: row.tweetUrl ?? `https://x.com/i/status/${row.tweetId}`,
							text: row.tweetText,
							authorName: row.authorName,
							authorHandle: row.authorHandle,
							postedAt: row.postedAt,
							quote: row.quote ?? null
						}
					: null,
			fetchState: row.fetchState,
			fetchError: row.fetchError,
			media: own,
			createdAt: row.createdAt,
			needsRetry: row.kind === 'tweet' && (row.fetchState === 'failed' || missing)
		};
	});
}

/** Where the full file is served: from disk, or streamed from Zipline through /file/<id>. */
export function fileUrl(row: Pick<MediaRow, 'id' | 'path' | 'ziplineId' | 'ziplineGoneAt'>) {
	if (row.path) return mediaUrl(row.path);
	return row.ziplineId && !row.ziplineGoneAt ? `/file/${row.id}` : null;
}

function mediaView(row: MediaRow): MediaView {
	return {
		id: row.id,
		kind: row.kind,
		url: fileUrl(row),
		gone: Boolean(row.ziplineGoneAt),
		thumb: mediaUrl(row.thumbPath),
		mime: row.mime,
		width: row.width,
		height: row.height,
		durationMs: row.durationMs,
		alt: row.alt,
		mirrorUrl: row.mirrorUrl
	};
}

export interface NewItem {
	readonly kind: ItemKind;
	readonly owner: Owner;
	readonly collectionId?: string | null;
	readonly caption?: string;
	readonly tags?: string | readonly string[];
	readonly sourceUrl?: string | null;
	readonly tweetId?: string | null;
	readonly tweetUrl?: string | null;
	readonly fetchState?: FetchState;
	/** Lets several items saved together keep their order; defaults to now. */
	readonly createdAt?: string;
}

export function createItem(db: Db, input: NewItem): string {
	const tags = normaliseTags(input.tags);
	return db.transaction((tx) => {
		const row = tx
			.insert(items)
			.values({
				kind: input.kind,
				owner: input.owner,
				collectionId: input.collectionId ?? null,
				caption: (input.caption ?? '').trim(),
				tagText: tags.join(' '),
				sourceUrl: input.sourceUrl ?? null,
				tweetId: input.tweetId ?? null,
				tweetUrl: input.tweetUrl ?? null,
				fetchState: input.fetchState ?? 'none',
				...(input.createdAt ? { createdAt: input.createdAt } : {})
			})
			.returning({ id: items.id })
			.get();
		if (tags.length > 0)
			tx.insert(itemTags)
				.values(tags.map((tag) => ({ itemId: row.id, tag })))
				.run();
		return row.id;
	});
}

export interface ItemPatch {
	readonly caption?: string;
	readonly tags?: string | readonly string[];
	readonly sourceUrl?: string | null;
	readonly owner?: Owner;
	readonly collectionId?: string | null;
}

/** Changes what she can edit. Returns false when the item isn't there (or isn't hers to see). */
export function updateItem(db: Db, id: string, scope: Scope | null, patch: ItemPatch): boolean {
	if (!getItemRow(db, id, scope)) return false;
	db.transaction((tx) => {
		const tags = patch.tags === undefined ? undefined : normaliseTags(patch.tags);
		tx.update(items)
			.set({
				...(patch.caption !== undefined ? { caption: patch.caption.trim() } : {}),
				...(patch.sourceUrl !== undefined ? { sourceUrl: patch.sourceUrl } : {}),
				...(patch.owner !== undefined ? { owner: patch.owner } : {}),
				...(patch.collectionId !== undefined ? { collectionId: patch.collectionId } : {}),
				...(tags !== undefined ? { tagText: tags.join(' ') } : {}),
				updatedAt: new Date().toISOString()
			})
			.where(eq(items.id, id))
			.run();
		if (tags !== undefined) {
			tx.delete(itemTags).where(eq(itemTags.itemId, id)).run();
			if (tags.length > 0)
				tx.insert(itemTags)
					.values(tags.map((tag) => ({ itemId: id, tag })))
					.run();
		}
	});
	return true;
}

/** The tweet as read from FxTwitter or vxTwitter. */
export interface TweetFields {
	readonly tweetUrl: string;
	readonly tweetText: string;
	readonly authorName: string;
	readonly authorHandle: string;
	readonly postedAt: string | null;
	readonly quote: QuotedTweet | null;
}

export function recordTweet(db: Db, id: string, fields: TweetFields): void {
	db.update(items)
		.set({
			...fields,
			fetchState: 'ok',
			fetchError: null,
			fetchedAt: new Date().toISOString()
		})
		.where(eq(items.id, id))
		.run();
}

export function recordFetchFailure(db: Db, id: string, reason: string): void {
	db.update(items)
		.set({
			fetchState: 'failed',
			fetchError: reason.slice(0, 300),
			fetchedAt: new Date().toISOString()
		})
		.where(eq(items.id, id))
		.run();
}

export interface NewMedia {
	readonly itemId: string;
	readonly position: number;
	readonly kind: MediaKind;
	readonly mime?: string | null;
	readonly path?: string | null;
	readonly thumbPath?: string | null;
	readonly width?: number | null;
	readonly height?: number | null;
	readonly bytes?: number | null;
	readonly durationMs?: number | null;
	readonly alt?: string | null;
	readonly remoteUrl?: string | null;
	readonly posterUrl?: string | null;
	readonly mirrorUrl?: string | null;
	readonly ziplineId?: string | null;
	readonly ziplineName?: string | null;
	readonly keepLocal?: boolean;
	readonly storageNote?: string | null;
	/** Reuse an id chosen before the file was written (it names the file). */
	readonly id?: string;
}

export function addMedia(db: Db, input: NewMedia): string {
	return db.insert(media).values(input).returning({ id: media.id }).get().id;
}

export function updateMedia(
	db: Db,
	id: string,
	patch: Partial<Omit<NewMedia, 'itemId' | 'id'>> & { ziplineGoneAt?: string | null }
): void {
	db.update(media).set(patch).where(eq(media.id, id)).run();
}

/**
 * Deletes items the scope can see. Returns the stored files (relative paths) that now belong
 * to nothing, for the caller to remove from disk, and their Zipline ids.
 */
export function deleteItems(
	db: Db,
	ids: readonly string[],
	scope: Scope | null
): { deleted: number; files: string[]; zipline: string[] } {
	if (ids.length === 0) return { deleted: 0, files: [], zipline: [] };
	return db.transaction((tx) => {
		const visible = tx
			.select({ id: items.id })
			.from(items)
			.where(and(inArray(items.id, [...ids]), ownedBy(items.owner, scope)))
			.all()
			.map((row) => row.id);
		if (visible.length === 0) return { deleted: 0, files: [], zipline: [] };
		const rows = tx
			.select({ path: media.path, thumb: media.thumbPath, zipline: media.ziplineId })
			.from(media)
			.where(inArray(media.itemId, visible))
			.all();
		const files = rows
			.flatMap((row) => [row.path, row.thumb])
			.filter((path): path is string => Boolean(path));
		const zipline = rows.map((row) => row.zipline).filter((id): id is string => Boolean(id));
		tx.delete(items).where(inArray(items.id, visible)).run();
		return { deleted: visible.length, files, zipline };
	});
}

/** Zipline files the sync must leave alone from now on. */
export function ignoreZipline(db: Db, ids: readonly string[], reason: string): void {
	for (const id of ids)
		db.insert(ziplineIgnored)
			.values({ ziplineId: id, reason })
			.onConflictDoUpdate({ target: ziplineIgnored.ziplineId, set: { reason } })
			.run();
}

/** Moves the items the scope can see into a collection (null: unsorted). */
export function moveItems(
	db: Db,
	ids: readonly string[],
	collectionId: string | null,
	scope: Scope | null
): number {
	if (ids.length === 0) return 0;
	return db
		.update(items)
		.set({ collectionId, updatedAt: new Date().toISOString() })
		.where(and(inArray(items.id, [...ids]), ownedBy(items.owner, scope)))
		.run().changes;
}

/** Every tag in use in the scope, most used first. */
export function listTags(db: Db, scope?: Scope | null): Array<{ tag: string; count: number }> {
	return db
		.select({ tag: itemTags.tag, count: sql<number>`count(*)` })
		.from(itemTags)
		.innerJoin(items, eq(itemTags.itemId, items.id))
		.where(ownedBy(items.owner, scope))
		.groupBy(itemTags.tag)
		.orderBy(desc(sql`count(*)`), asc(itemTags.tag))
		.all();
}
