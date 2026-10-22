import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { handleSave } from './api-save.ts';
import { openDatabase } from './db/client.ts';
import { findCollectionByName, seedCollections } from './db/collections.ts';
import { countItems, getItem } from './db/items.ts';
import { bearerAllowed, originAllowed } from './guard.ts';
import { Storage } from './media/storage.ts';
import { MediaStore } from './media/store.ts';
import type { SaveServices } from './save.ts';

const TOKEN = 'a-long-random-save-token-0123456789';
const fixtures = new URL('../../../tests/fixtures/tweets/', import.meta.url);
const migrationsFolder = new URL('../../../migrations', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'archive-save-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const pixel = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3fd8ff' } })
	.png()
	.toBuffer();

/** A fake internet: the recorded GIF tweet from FxTwitter, a picture for every file. */
const fakeFetch = async (url: string) => {
	const host = new URL(url).hostname;
	if (host === 'api.fxtwitter.com')
		return new Response(readFileSync(new URL('fx-1724489664562659673.json', fixtures)), {
			status: 200
		});
	if (host === 'pbs.twimg.com') return new Response(pixel, { status: 200 });
	if (host === 'video.twimg.com')
		return new Response(Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 0, 0]), {
			status: 200
		});
	return new Response('no', { status: 404 });
};

function setup(token: string | null = TOKEN) {
	const archive = openDatabase({ path: ':memory:', migrationsFolder });
	seedCollections(archive.db);
	const services: SaveServices = {
		db: archive.db,
		store: new Storage({ local: new MediaStore(join(root, String(Math.random()).slice(2)), 64) }),
		maxUploadBytes: 1e6,
		maxTweetMediaBytes: 1e6,
		timeoutMs: 1000,
		fetchImpl: fakeFetch
	};
	const save = (body: BodyInit | null, headers: Record<string, string> = {}) =>
		handleSave(new Request('http://archive.test/api/save', { method: 'POST', body, headers }), {
			services,
			token,
			origin: 'https://archive.niijimasisters.com'
		});
	return { ...archive, services, save };
}

const form = (fields: Record<string, string | Blob>) => {
	const data = new FormData();
	for (const [name, value] of Object.entries(fields)) data.append(name, value);
	return data;
};
const auth = { authorization: `Bearer ${TOKEN}` };

describe('/api/save sign-in', () => {
	it('refuses requests without the right bearer token and saves nothing', async () => {
		const { save, db } = setup();
		const body = () => form({ url: 'https://x.com/SpongeBob/status/1724489664562659673' });
		expect((await save(body())).status).toBe(401);
		expect((await save(body(), { authorization: 'Bearer nope' })).status).toBe(401);
		expect((await save(body(), { authorization: TOKEN })).status).toBe(401);
		expect((await save(body(), { cookie: 'nj_session=whatever' })).status).toBe(401);
		expect(countItems(db, {})).toBe(0);
	});

	it('is off entirely while SAVE_TOKEN is not set', async () => {
		const { save } = setup(null);
		const response = await save(form({ url: 'https://x.com/a/status/1' }), {
			authorization: 'Bearer '
		});
		expect(response.status).toBe(404);
	});

	it('checks the token in constant time and only as a Bearer header', () => {
		expect(bearerAllowed(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
		expect(bearerAllowed(`bearer ${TOKEN}  `, TOKEN)).toBe(true);
		expect(bearerAllowed(`Basic ${TOKEN}`, TOKEN)).toBe(false);
		expect(bearerAllowed(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
		expect(bearerAllowed('Bearer ', '')).toBe(false);
		expect(bearerAllowed(null, TOKEN)).toBe(false);
	});
});

describe('/api/save', () => {
	it('saves a tweet with its caption into a collection named in any case', async () => {
		const { save, db } = setup();
		const response = await save(
			form({
				url: 'Look https://x.com/SpongeBob/status/1724489664562659673?s=46',
				caption: 'Pickle day energy',
				collection: 'sae',
				tags: 'mood, gif'
			}),
			auth
		);
		expect(response.status).toBe(201);
		const body = await response.json();
		expect(body).toMatchObject({ ok: true, fetched: true, duplicate: false });
		const item = getItem(db, body.items[0].id)!;
		expect(item).toMatchObject({
			kind: 'tweet',
			owner: 'sae',
			caption: 'Pickle day energy',
			fetchState: 'ok'
		});
		expect(item.collection?.name).toBe('Sae');
		expect(item.tags).toEqual(['gif', 'mood']);
		expect(item.tweet?.authorHandle).toBe('SpongeBob');
		expect(item.media).toHaveLength(1);
		expect(item.media[0]).toMatchObject({ kind: 'gif' });
		expect(item.media[0]!.url).toMatch(/^\/media\/\d{4}\/\d{2}\/[a-z0-9]+\.mp4$/);
		expect(item.media[0]!.thumb).toMatch(/\.thumb\.webp$/);

		const again = await save(
			form({ url: 'https://twitter.com/SpongeBob/status/1724489664562659673' }),
			auth
		);
		expect(again.status).toBe(200);
		expect((await again.json()).duplicate).toBe(true);
	});

	it('saves uploaded files with JSON-less form fields, and rejects what is not media', async () => {
		const { save, db } = setup();
		const response = await save(
			form({
				file: new Blob([pixel], { type: 'image/png' }),
				caption: 'Talia',
				collection: 'Roman / Talia / Omi',
				url: 'https://example.com/art/1'
			}),
			auth
		);
		expect(response.status).toBe(201);
		const { items } = await response.json();
		const item = getItem(db, items[0].id)!;
		expect(item).toMatchObject({
			kind: 'image',
			owner: 'shared',
			caption: 'Talia',
			sourceUrl: 'https://example.com/art/1'
		});
		expect(item.collection?.id).toBe(findCollectionByName(db, 'Roman / Talia / Omi')!.id);

		const bad = await save(
			form({ file: new Blob(['<svg onload=alert(1)>'], { type: 'image/png' }) }),
			auth
		);
		expect(bad.status).toBe(415);
	});

	it('explains what is missing', async () => {
		const { save } = setup();
		expect((await save(form({ url: 'https://example.com' }), auth)).status).toBe(400);
		const unknown = await save(form({ url: 'https://x.com/a/status/1', collection: 'Nope' }), auth);
		expect(unknown.status).toBe(400);
		expect((await unknown.json()).collections).toContain('Makoto');
		expect((await save('plain', { ...auth, 'content-type': 'text/plain' })).status).toBe(400);
	});
});

describe('origin check', () => {
	const allowed = ['https://archive.niijimasisters.com'];
	const check = (method: string, path: string, origin: string | null) =>
		originAllowed({ method, path, origin, allowed });

	it('lets reads through and wants this site on every change', () => {
		expect(check('GET', '/', 'https://evil.example')).toBe(true);
		expect(check('POST', '/item/abc?/save', 'https://archive.niijimasisters.com')).toBe(true);
		expect(check('POST', '/item/abc?/save', 'https://evil.example')).toBe(false);
		expect(check('POST', '/api/upload', null)).toBe(false);
		expect(check('POST', '/api/upload', 'https://treasure.niijimasisters.com')).toBe(false);
	});

	it("lets Android's share sheet in without an Origin, and /api/save on its token", () => {
		expect(check('POST', '/share', null)).toBe(true);
		expect(check('POST', '/share', 'null')).toBe(true);
		expect(check('POST', '/share', 'https://evil.example')).toBe(false);
		expect(check('POST', '/api/save', 'https://evil.example')).toBe(true);
	});
});
