import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { CollectionOption, CollectionView } from '$lib/types.ts';
import { getSetting, setSetting, type Db } from './client.ts';
import { mediaUrl } from './items.ts';
import { collections, items, media, type CollectionRow, type Owner } from './schema.ts';
import { ownedBy, type Scope } from './scope.ts';

/** The collections a fresh Archive starts with. She can rename or delete them. */
export const STARTING_COLLECTIONS: ReadonlyArray<{ name: string; owner: Owner }> = [
	{ name: 'Makoto', owner: 'makoto' },
	{ name: 'Sae', owner: 'sae' },
	{ name: 'Roman / Talia / Omi', owner: 'shared' }
];

/**
 * Creates the starting collections once, on the very first run. A flag remembers it, so ones
 * she deletes never come back.
 */
export function seedCollections(db: Db): number {
	if (getSetting<boolean>(db, 'seeded_collections')) return 0;
	const existing =
		db
			.select({ n: sql<number>`count(*)` })
			.from(collections)
			.get()?.n ?? 0;
	let added = 0;
	db.transaction((tx) => {
		if (existing === 0) {
			for (const collection of STARTING_COLLECTIONS) {
				tx.insert(collections).values(collection).run();
				added++;
			}
		}
	});
	setSetting(db, 'seeded_collections', true);
	return added;
}

export function collectionOptions(db: Db, scope?: Scope | null): CollectionOption[] {
	return db
		.select({ id: collections.id, name: collections.name, owner: collections.owner })
		.from(collections)
		.where(ownedBy(collections.owner, scope))
		.orderBy(asc(sql`lower(${collections.name})`))
		.all();
}

export function getCollection(db: Db, id: string, scope?: Scope | null): CollectionRow | null {
	return (
		db
			.select()
			.from(collections)
			.where(and(eq(collections.id, id), ownedBy(collections.owner, scope)))
			.get() ?? null
	);
}

/** A collection by name, ignoring case (for /api/save and iOS Shortcuts). */
export function findCollectionByName(
	db: Db,
	name: string,
	scope?: Scope | null
): CollectionRow | null {
	return (
		db
			.select()
			.from(collections)
			.where(
				and(
					sql`lower(${collections.name}) = lower(${name.trim()})`,
					ownedBy(collections.owner, scope)
				)
			)
			.get() ?? null
	);
}

/** The collections with their item counts and cover pictures, as the scope sees them. */
export function listCollections(db: Db, scope?: Scope | null): CollectionView[] {
	const counts = new Map(
		db
			.select({ id: items.collectionId, n: sql<number>`count(*)` })
			.from(items)
			.where(ownedBy(items.owner, scope))
			.groupBy(items.collectionId)
			.all()
			.map((row) => [row.id ?? 'none', row.n])
	);
	return collectionOptions(db, scope).map((option) => {
		const row = getCollection(db, option.id)!;
		return {
			...option,
			count: counts.get(option.id) ?? 0,
			coverItemId: row.coverItemId,
			cover: coverOf(db, row, scope)
		};
	});
}

/** How many items the scope sees outside any collection. */
export function unsortedCount(db: Db, scope?: Scope | null): number {
	return (
		db
			.select({ n: sql<number>`count(*)` })
			.from(items)
			.where(and(sql`${items.collectionId} IS NULL`, ownedBy(items.owner, scope)))
			.get()?.n ?? 0
	);
}

function coverOf(db: Db, row: CollectionRow, scope?: Scope | null): CollectionView['cover'] {
	const pick = (condition: ReturnType<typeof eq>) =>
		db
			.select({ thumb: media.thumbPath, width: media.width, height: media.height })
			.from(media)
			.innerJoin(items, eq(media.itemId, items.id))
			.where(and(condition, isNotNull(media.thumbPath), ownedBy(items.owner, scope)))
			.orderBy(desc(items.createdAt), asc(media.position))
			.limit(1)
			.get();
	const chosen = row.coverItemId ? pick(eq(items.id, row.coverItemId)) : undefined;
	const found = chosen ?? pick(eq(items.collectionId, row.id));
	return found?.thumb
		? { thumb: mediaUrl(found.thumb)!, width: found.width, height: found.height }
		: null;
}

export function createCollection(db: Db, input: { name: string; owner: Owner }): string {
	return db
		.insert(collections)
		.values({ name: input.name.trim(), owner: input.owner })
		.returning({ id: collections.id })
		.get().id;
}

export function updateCollection(
	db: Db,
	id: string,
	scope: Scope | null,
	patch: { name?: string; owner?: Owner; coverItemId?: string | null }
): boolean {
	return (
		db
			.update(collections)
			.set({
				...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
				...(patch.owner !== undefined ? { owner: patch.owner } : {}),
				...(patch.coverItemId !== undefined ? { coverItemId: patch.coverItemId } : {}),
				updatedAt: new Date().toISOString()
			})
			.where(and(eq(collections.id, id), ownedBy(collections.owner, scope)))
			.run().changes > 0
	);
}

/** Deletes a collection. Its items stay, unsorted. */
export function deleteCollection(db: Db, id: string, scope: Scope | null): boolean {
	return (
		db
			.delete(collections)
			.where(and(eq(collections.id, id), ownedBy(collections.owner, scope)))
			.run().changes > 0
	);
}
