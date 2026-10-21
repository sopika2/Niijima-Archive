import { describe, expect, it } from 'vitest';
import { openDatabase } from './client.ts';
import {
	collectionOptions,
	createCollection,
	deleteCollection,
	findCollectionByName,
	listCollections,
	seedCollections
} from './collections.ts';
import {
	countItems,
	createItem,
	deleteItems,
	getItem,
	listItems,
	listTags,
	moveItems,
	recordTweet,
	updateItem
} from './items.ts';
import { scopeFor } from './scope.ts';
import { ftsQuery } from './search.ts';
import { normaliseTags } from './tags.ts';

const migrationsFolder = new URL('../../../../migrations', import.meta.url).pathname;

function setup() {
	const archive = openDatabase({ path: ':memory:', migrationsFolder });
	const { db } = archive;
	const bike = createItem(db, {
		kind: 'image',
		owner: 'makoto',
		caption: 'Queen on Johanna, the café at night',
		tags: 'bike, #queen'
	});
	const gavel = createItem(db, {
		kind: 'image',
		owner: 'sae',
		caption: 'Courtroom sketch',
		tags: 'work'
	});
	const tweet = createItem(db, {
		kind: 'tweet',
		owner: 'shared',
		caption: 'For the edgerunners wall',
		tweetId: '1724489664562659673',
		fetchState: 'ok'
	});
	recordTweet(db, tweet, {
		tweetUrl: 'https://x.com/SpongeBob/status/1724489664562659673',
		tweetText: 'ima start a streak im a streakstarter',
		authorName: 'SpongeBob',
		authorHandle: 'SpongeBob',
		postedAt: '2023-11-14T18:09:10.000Z',
		quote: {
			url: 'https://x.com/KDA_MUSIC/status/1',
			text: 'Watch it burn',
			authorName: 'K/DA',
			authorHandle: 'KDA_MUSIC'
		}
	});
	return { ...archive, bike, gavel, tweet };
}

describe('personas', () => {
	it('each persona sees her own items and the shared ones', () => {
		const { db, close } = setup();
		const ids = (persona: 'makoto' | 'sae') =>
			listItems(db, { scope: scopeFor(persona) }, { limit: 50 }).items.map((item) => item.caption);
		expect(ids('makoto').sort()).toEqual([
			'For the edgerunners wall',
			'Queen on Johanna, the café at night'
		]);
		expect(ids('sae').sort()).toEqual(['Courtroom sketch', 'For the edgerunners wall']);
		expect(countItems(db, {})).toBe(3);
		close();
	});

	it("can't read, edit, move or delete what the persona can't see", () => {
		const { db, close, bike, gavel } = setup();
		const makoto = scopeFor('makoto');
		expect(getItem(db, gavel, makoto)).toBeNull();
		expect(updateItem(db, gavel, makoto, { caption: 'mine now' })).toBe(false);
		const shelf = createCollection(db, { name: 'Shelf', owner: 'shared' });
		expect(moveItems(db, [bike, gavel], shelf, makoto)).toBe(1);
		expect(deleteItems(db, [gavel], makoto).deleted).toBe(0);
		expect(getItem(db, gavel, scopeFor('sae'))?.caption).toBe('Courtroom sketch');
		close();
	});

	it('collections and tags follow the scope too', () => {
		const { db, close } = setup();
		expect(seedCollections(db)).toBe(3);
		expect(seedCollections(db)).toBe(0);
		expect(collectionOptions(db, scopeFor('makoto')).map((c) => c.name)).toEqual([
			'Makoto',
			'Roman / Talia / Omi'
		]);
		expect(collectionOptions(db, scopeFor('sae')).map((c) => c.name)).toEqual([
			'Roman / Talia / Omi',
			'Sae'
		]);
		expect(findCollectionByName(db, 'sae', scopeFor('makoto'))).toBeNull();
		expect(findCollectionByName(db, ' roman / talia / OMI ')?.owner).toBe('shared');
		expect(listTags(db, scopeFor('sae')).map((t) => t.tag)).toEqual(['work']);
		close();
	});

	it('deleted starting collections stay deleted; their items become unsorted', () => {
		const { db, close, bike } = setup();
		seedCollections(db);
		const makoto = findCollectionByName(db, 'Makoto')!;
		moveItems(db, [bike], makoto.id, null);
		expect(listCollections(db, scopeFor('makoto')).find((c) => c.name === 'Makoto')?.count).toBe(1);
		expect(deleteCollection(db, makoto.id, scopeFor('sae'))).toBe(false);
		expect(deleteCollection(db, makoto.id, scopeFor('makoto'))).toBe(true);
		expect(seedCollections(db)).toBe(0);
		expect(getItem(db, bike)?.collection).toBeNull();
		expect(countItems(db, { collectionId: 'none' })).toBe(3);
		close();
	});
});

describe('search', () => {
	const found = (db: ReturnType<typeof setup>['db'], q: string, persona?: 'makoto' | 'sae') =>
		listItems(db, { q, scope: persona ? scopeFor(persona) : null }, { limit: 50 }).items.map(
			(item) => item.caption
		);

	it('finds words in captions, tweet text, authors, tags and quoted tweets', () => {
		const { db, close } = setup();
		expect(found(db, 'johanna')).toEqual(['Queen on Johanna, the café at night']);
		expect(found(db, 'streakstarter')).toEqual(['For the edgerunners wall']);
		expect(found(db, '@spongebob')).toEqual(['For the edgerunners wall']);
		expect(found(db, '#queen')).toEqual(['Queen on Johanna, the café at night']);
		expect(found(db, 'burn')).toEqual(['For the edgerunners wall']);
		close();
	});

	it('matches word starts and ignores accents and case', () => {
		const { db, close } = setup();
		expect(found(db, 'STREA')).toEqual(['For the edgerunners wall']);
		expect(found(db, 'cafe')).toEqual(['Queen on Johanna, the café at night']);
		expect(found(db, 'queen night')).toEqual(['Queen on Johanna, the café at night']);
		expect(found(db, 'queen courtroom')).toEqual([]);
		close();
	});

	it('takes FTS5 syntax as plain words and respects the persona', () => {
		const { db, close } = setup();
		for (const q of ['"', 'OR', 'NOT queen', 'queen*', '(', 'a:b', '-', '^queen', 'NEAR(x y)'])
			expect(() => found(db, q)).not.toThrow();
		expect(found(db, 'courtroom', 'makoto')).toEqual([]);
		expect(found(db, 'courtroom', 'sae')).toEqual(['Courtroom sketch']);
		close();
	});

	it('updates the index when a caption or tags change, and forgets deleted items', () => {
		const { db, close, bike, gavel } = setup();
		updateItem(db, bike, null, { caption: 'Motorcycle', tags: ['garage'] });
		expect(found(db, 'johanna')).toEqual([]);
		expect(found(db, 'garage')).toEqual(['Motorcycle']);
		deleteItems(db, [gavel], null);
		expect(found(db, 'courtroom')).toEqual([]);
		close();
	});

	it('builds a safe query from anything typed', () => {
		expect(ftsQuery('  ')).toBeNull();
		expect(ftsQuery('"Makoto" OR bike*')).toBe('"makoto"* "or"* "bike"*');
		expect(ftsQuery('#Queen @NASA')).toBe('"queen"* "nasa"*');
	});
});

describe('tags and paging', () => {
	it('normalises tags', () => {
		expect(normaliseTags('Makoto, #bike  fanart,,BIKE')).toEqual(['makoto', 'bike', 'fanart']);
		expect(normaliseTags(['a b', 'c!'])).toEqual(['a', 'b', 'c']);
		expect(normaliseTags(null)).toEqual([]);
	});

	it('pages newest first without repeats', () => {
		const { db, close } = setup();
		for (let i = 0; i < 7; i++)
			createItem(db, {
				kind: 'image',
				owner: 'shared',
				caption: `n${i}`,
				createdAt: '2030-01-01T00:00:00.000Z'
			});
		const seen: string[] = [];
		let cursor: string | null = null;
		do {
			const page = listItems(db, {}, { cursor, limit: 3 });
			seen.push(...page.items.map((item) => item.id));
			cursor = page.next;
		} while (cursor);
		expect(seen).toHaveLength(10);
		expect(new Set(seen).size).toBe(10);
		close();
	});
});
