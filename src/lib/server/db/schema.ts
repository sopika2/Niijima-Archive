import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import { newId } from '../ids.ts';

/*
 * Six tables. Timestamps are ISO 8601 text in UTC. Files live on Zipline (Mementos) when it is
 * set up, otherwise on disk under data/media; thumbnails always on disk under data/thumbs. Full-text search (items_fts) is an FTS5 table kept
 * in step by triggers, created in a hand-written migration because Drizzle can't describe it.
 */

const id = () => text('id').primaryKey().$defaultFn(newId);
const now = () => new Date().toISOString();
const createdAt = () => text('created_at').notNull().$defaultFn(now);
const updatedAt = () => text('updated_at').notNull().$defaultFn(now).$onUpdateFn(now);

/**
 * Whose it is: Makoto's, Sae's, or both sisters' (shared). Each persona sees her own and the
 * shared ones.
 */
export const owners = ['makoto', 'sae', 'shared'] as const;
export type Owner = (typeof owners)[number];
const owner = () => text('owner', { enum: owners }).notNull().default('shared');

export const itemKinds = ['tweet', 'image'] as const;
export type ItemKind = (typeof itemKinds)[number];
export const mediaKinds = ['image', 'gif', 'video'] as const;
export type MediaKind = (typeof mediaKinds)[number];
/** none: an upload, nothing to fetch. ok: the tweet was read. failed: only the link is kept. */
export const fetchStates = ['none', 'ok', 'failed'] as const;
export type FetchState = (typeof fetchStates)[number];

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).notNull(),
	updatedAt: updatedAt()
});

export const collections = sqliteTable(
	'collections',
	{
		id: id(),
		name: text('name').notNull(),
		owner: owner(),
		/** The item whose picture fronts the collection; the newest picture when unset. */
		coverItemId: text('cover_item_id').references((): AnySQLiteColumn => items.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [index('collections_owner_idx').on(table.owner)]
);

export const items = sqliteTable(
	'items',
	{
		id: id(),
		kind: text('kind', { enum: itemKinds }).notNull(),
		owner: owner(),
		collectionId: text('collection_id').references((): AnySQLiteColumn => collections.id, {
			onDelete: 'set null'
		}),
		/** Her own note: why it was saved. The point of the whole app. */
		caption: text('caption').notNull().default(''),
		/** The tags, space separated, for search. The item_tags table is the one to filter on. */
		tagText: text('tag_text').notNull().default(''),
		/** Where an image came from (a page, an artist), or the tweet link it was shared with. */
		sourceUrl: text('source_url'),

		tweetId: text('tweet_id'),
		tweetUrl: text('tweet_url'),
		tweetText: text('tweet_text'),
		authorName: text('author_name'),
		authorHandle: text('author_handle'),
		/** When the tweet was posted. */
		postedAt: text('posted_at'),
		/** The quoted tweet, if any: { url, text, authorName, authorHandle }. */
		quote: text('quote', { mode: 'json' }).$type<QuotedTweet | null>(),
		fetchState: text('fetch_state', { enum: fetchStates }).notNull().default('none'),
		fetchError: text('fetch_error'),
		fetchedAt: text('fetched_at'),

		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(table) => [
		index('items_created_idx').on(table.createdAt, table.id),
		index('items_collection_idx').on(table.collectionId),
		index('items_owner_idx').on(table.owner),
		index('items_tweet_idx').on(table.tweetId)
	]
);

export interface QuotedTweet {
	readonly url: string;
	readonly text: string;
	readonly authorName: string;
	readonly authorHandle: string;
}

export const itemTags = sqliteTable(
	'item_tags',
	{
		itemId: text('item_id')
			.notNull()
			.references(() => items.id, { onDelete: 'cascade' }),
		tag: text('tag').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.itemId, table.tag] }),
		index('item_tags_tag_idx').on(table.tag)
	]
);

export const media = sqliteTable(
	'media',
	{
		id: id(),
		itemId: text('item_id')
			.notNull()
			.references(() => items.id, { onDelete: 'cascade' }),
		position: integer('position').notNull().default(0),
		kind: text('kind', { enum: mediaKinds }).notNull(),
		/** Content type of the stored file. */
		mime: text('mime'),
		/** The file, relative to data/media: 2026/10/<id>.jpg. Null when its download failed. */
		path: text('path'),
		/** A still WebP for the grid, relative to data/media. Null for a video without a poster. */
		thumbPath: text('thumb_path'),
		width: integer('width'),
		height: integer('height'),
		bytes: integer('bytes'),
		durationMs: integer('duration_ms'),
		alt: text('alt'),
		/** Where a tweet's file was downloaded from, so a failed download can be retried. */
		remoteUrl: text('remote_url'),
		/** The tweet video's still frame, downloaded as the thumbnail. */
		posterUrl: text('poster_url'),
		/** The public link on Mementos (Zipline), for sharing. */
		mirrorUrl: text('mirror_url'),
		/** The file's id on Zipline when Zipline stores it; then `path` is usually null. */
		ziplineId: text('zipline_id'),
		/** Its name on Zipline (the part after /u/), for the raw route and older Ziplines. */
		ziplineName: text('zipline_name'),
		/** When the sync noticed the file was deleted on Zipline. Cleared if it comes back. */
		ziplineGoneAt: text('zipline_gone_at'),
		/**
		 * Keep the file on the Archive's disk: Zipline's copy didn't match (Zipline stripped GPS
		 * data, say), so the original is never removed. `storageNote` says why.
		 */
		keepLocal: integer('keep_local', { mode: 'boolean' }).notNull().default(false),
		/** The last upload problem, or why the file stays local. */
		storageNote: text('storage_note'),
		createdAt: createdAt()
	},
	(table) => [
		index('media_item_idx').on(table.itemId, table.position),
		index('media_zipline_idx').on(table.ziplineId)
	]
);

/**
 * Zipline files the sync must not import: ones whose item she deleted but kept on Mementos, and
 * files that turned out not to be pictures or videos.
 */
export const ziplineIgnored = sqliteTable('zipline_ignored', {
	ziplineId: text('zipline_id').primaryKey(),
	reason: text('reason').notNull(),
	createdAt: createdAt()
});

export type CollectionRow = typeof collections.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
