import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeZipline, type FakeOptions } from '../../../tests/fake-zipline.ts';
import { openDatabase } from './db/client.ts';
import { getCollection, seedCollections } from './db/collections.ts';
import { addMedia, createItem, getItem, listItems, mediaOf } from './db/items.ts';
import { exportZip } from './export.ts';
import { proxyZipline } from './media/proxy.ts';
import { Storage } from './media/storage.ts';
import { MediaStore } from './media/store.ts';
import { Mementos } from './mementos.ts';
import { removeItems, saveUpload, type SaveServices } from './save.ts';
import { Zipline } from './zipline.ts';

const migrationsFolder = new URL('../../../migrations', import.meta.url).pathname;
const root = mkdtempSync(join(tmpdir(), 'archive-mementos-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const PUBLIC = 'https://mementos.niijimasisters.com';

const picture = (colour: string, width = 64, height = 48) =>
	sharp({ create: { width, height, channels: 3, background: colour } })
		.png()
		.toBuffer();

function setup(options: FakeOptions & { withZipline?: boolean; fetch?: typeof fetch } = {}) {
	const dir = join(root, String(Math.random()).slice(2));
	const archive = openDatabase({ path: ':memory:', migrationsFolder });
	seedCollections(archive.db);
	const fake = new FakeZipline(options);
	const zipline =
		options.withZipline === false
			? null
			: new Zipline({
					url: PUBLIC,
					internalUrl: 'http://zipline:3000',
					token: fake.token,
					fetchImpl: options.fetch ?? fake.fetch
				});
	const local = new MediaStore(join(dir, 'media'), 64, join(dir, 'thumbs'));
	const storage = new Storage({ local, zipline, folder: 'Archive' });
	const services: SaveServices = {
		db: archive.db,
		store: storage,
		maxUploadBytes: 5e6,
		maxTweetMediaBytes: 5e6,
		timeoutMs: 1000
	};
	const mementos = zipline
		? new Mementos({
				db: archive.db,
				storage,
				zipline,
				syncMinutes: 5,
				inbox: 'Inbox',
				maxImportBytes: 5e6,
				sleep: async () => {}
			})
		: null;
	const upload = async (colour: string) =>
		saveUpload(
			services,
			{ bytes: await picture(colour), caption: colour },
			{ owner: 'makoto', collectionId: null, tags: '' }
		);
	return { ...archive, dir, fake, zipline, local, storage, services, mementos, upload };
}

const filesIn = (dir: string): string[] =>
	existsSync(dir)
		? readdirSync(dir, { recursive: true, withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => entry.name)
		: [];

describe('saving with Zipline as the storage', () => {
	it('puts the original on Zipline and keeps only the thumbnail', async () => {
		const { db, fake, dir, upload } = setup();
		const bytes = await picture('#d90416');
		const id = await upload('#d90416');
		const [row] = mediaOf(db, id);
		const remote = fake.files.get(row!.ziplineId!)!;
		expect(remote.bytes.equals(bytes)).toBe(true);
		expect(row).toMatchObject({
			path: null,
			ziplineName: remote.name,
			mirrorUrl: `${PUBLIC}/u/${remote.name}`,
			keepLocal: false
		});
		// Uploaded into the "Archive" folder, made on first use.
		expect([...fake.folders.values()].map((folder) => folder.name)).toEqual(['Archive']);
		expect(remote.folderId).toBe([...fake.folders.keys()][0]);
		expect(filesIn(join(dir, 'media'))).toEqual([]);
		expect(filesIn(join(dir, 'thumbs'))).toEqual([`${row!.id}.thumb.webp`]);
		const view = getItem(db, id)!;
		expect(view.media[0]).toMatchObject({ url: `/file/${row!.id}`, gone: false });
		expect(view.media[0]!.mirrorUrl).toBe(row!.mirrorUrl);
	});

	it('keeps the file on disk when Zipline is down, and the migration moves it later', async () => {
		const { db, fake, dir, upload, mementos } = setup();
		fake.down = true;
		const id = await upload('#3fd8ff');
		let [row] = mediaOf(db, id);
		expect(row!.path).toMatch(/\.png$/);
		expect(row!.storageNote).toMatch(/503/);
		expect(getItem(db, id)!.media[0]!.url).toBe(`/media/${row!.path}`);

		fake.down = false;
		await mementos!.run();
		[row] = mediaOf(db, id);
		expect(row).toMatchObject({ path: null, storageNote: null });
		expect(fake.files.has(row!.ziplineId!)).toBe(true);
		expect(filesIn(join(dir, 'media'))).toEqual([]);
		expect(mementos!.status().migration).toMatchObject({ pending: 0, moved: 1, kept: 0 });
	});

	it('keeps the original for good when Zipline changes the file', async () => {
		const { db, fake, dir, upload } = setup({
			mutate: (bytes) => Buffer.concat([bytes, Buffer.from('gps gone')])
		});
		const id = await upload('#ffd400');
		const [row] = mediaOf(db, id);
		expect(row).toMatchObject({ keepLocal: true });
		expect(row!.storageNote).toMatch(/changed copy/);
		expect(fake.files.has(row!.ziplineId!)).toBe(true);
		expect(filesIn(join(dir, 'media'))).toHaveLength(1);
		// Served from disk: the untouched original.
		expect(getItem(db, id)!.media[0]!.url).toBe(`/media/${row!.path}`);
	});

	it('works exactly as before without Zipline', async () => {
		const { db, dir, upload } = setup({ withZipline: false });
		const id = await upload('#0b0b0d');
		const [row] = mediaOf(db, id);
		expect(row).toMatchObject({ ziplineId: null, mirrorUrl: null });
		expect(existsSync(join(dir, 'media', row!.path!))).toBe(true);
		expect(existsSync(join(dir, 'thumbs', row!.thumbPath!))).toBe(true);
	});
});

describe('moving old files to Zipline', () => {
	/** An item saved before Zipline was set up: its original on disk. */
	async function oldItem(t: ReturnType<typeof setup>, colour: string, mirrorUrl?: string) {
		const file = await t.local.save(await picture(colour), { maxBytes: 5e6 });
		const itemId = createItem(t.db, { kind: 'image', owner: 'shared' });
		addMedia(t.db, { ...file, itemId, position: 0, ...(mirrorUrl ? { mirrorUrl } : {}) });
		return { itemId, file };
	}

	it('uploads, checks byte for byte, then removes the local copy', async () => {
		const t = setup();
		const one = await oldItem(t, '#111111');
		const two = await oldItem(t, '#222222');
		expect(t.mementos!.status().migration.pending).toBe(2);
		await t.mementos!.migrate();
		for (const { itemId } of [one, two]) {
			const [row] = mediaOf(t.db, itemId);
			expect(row).toMatchObject({ path: null, keepLocal: false });
			expect(t.fake.files.get(row!.ziplineId!)?.size).toBe(row!.bytes);
		}
		expect(filesIn(join(t.dir, 'media'))).toEqual([]);
		// It asked for the bytes back before removing anything.
		expect(t.fake.calls.filter((call) => call.endsWith('/raw'))).toHaveLength(2);
	});

	it("reuses a file the old 'Copy Mementos link' button uploaded", async () => {
		const t = setup();
		const bytes = await picture('#333333');
		const legacy = t.fake.addDirect('old123.png', bytes, 'image/png');
		const file = await t.local.save(bytes, { maxBytes: 5e6 });
		const itemId = createItem(t.db, { kind: 'image', owner: 'shared' });
		addMedia(t.db, { ...file, itemId, position: 0, mirrorUrl: `${PUBLIC}/u/old123.png` });
		await t.mementos!.run();
		const [row] = mediaOf(t.db, itemId);
		expect(row).toMatchObject({ ziplineId: legacy.id, path: null });
		expect(t.fake.calls.filter((call) => call === 'POST /api/upload')).toHaveLength(0);
		// And the sync doesn't bring it in again as her own upload.
		expect(listItems(t.db, {}, { limit: 50 }).items).toHaveLength(1);
	});

	it('picks up where it stopped: an upload that went through is not repeated', async () => {
		const t = setup();
		const { itemId } = await oldItem(t, '#444444');
		// Zipline goes away right after taking the file, before the check.
		const realRaw = t.zipline!.raw.bind(t.zipline!);
		t.zipline!.raw = async () => {
			throw new Error('connection reset');
		};
		await t.mementos!.migrate();
		let [row] = mediaOf(t.db, itemId);
		expect(row!.ziplineId).toBeTruthy();
		expect(row!.path).toBeTruthy();
		expect(filesIn(join(t.dir, 'media'))).toHaveLength(1);

		t.zipline!.raw = realRaw;
		await t.mementos!.retry();
		[row] = mediaOf(t.db, itemId);
		expect(row!.path).toBeNull();
		expect(t.fake.calls.filter((call) => call === 'POST /api/upload')).toHaveLength(1);
		expect(t.fake.files.size).toBe(1);
	});

	it('waits out a busy Zipline (429) and carries on', async () => {
		const t = setup();
		await oldItem(t, '#555555');
		t.fake.failNext = [429];
		await t.mementos!.migrate();
		expect(t.mementos!.status().migration).toMatchObject({ pending: 0, moved: 1 });
	});
});

describe('sync with her own Zipline uploads', () => {
	it('brings in new pictures and videos to the Inbox, once', async () => {
		const t = setup();
		const own = await t.upload('#d90416');
		const phone = t.fake.addDirect('phone.jpg', await picture('#3fd8ff', 300, 400), 'image/png');
		const clip = t.fake.addDirect('clip.mp4', Buffer.from('not really a video'), 'video/mp4', {
			thumbnail: { path: '.thumbnail.clip.jpg', bytes: await picture('#00ff00') }
		});
		t.fake.addDirect('notes.txt', Buffer.from('words'), 'text/plain');

		await t.mementos!.run();
		const all = listItems(t.db, {}, { limit: 50 }).items;
		expect(all).toHaveLength(3);
		const inbox = all.filter((item) => item.collection?.name === 'Inbox');
		expect(inbox).toHaveLength(2);
		expect(getCollection(t.db, inbox[0]!.collection!.id)?.owner).toBe('shared');
		const picked = inbox.find((item) => item.media[0]!.kind === 'image')!;
		expect(picked.media[0]).toMatchObject({
			width: 300,
			height: 400,
			mirrorUrl: `${PUBLIC}/u/phone.jpg`,
			url: `/file/${picked.media[0]!.id}`
		});
		expect(picked.media[0]!.thumb).toMatch(/\.thumb\.webp$/);
		expect(picked.createdAt).toBe(phone.createdAt);
		const video = inbox.find((item) => item.media[0]!.kind === 'video')!;
		expect(video.media[0]!.thumb).toMatch(/\.thumb\.webp$/);
		expect(mediaOf(t.db, video.id)[0]!.ziplineId).toBe(clip.id);
		expect(all.find((item) => item.id === own)!.collection).toBeNull();

		await t.mementos!.run();
		expect(listItems(t.db, {}, { limit: 50 }).items).toHaveLength(3);
		expect(t.mementos!.status().sync.last).toMatchObject({ files: 4, imported: 0 });
	});

	it('marks files deleted on Zipline, and unmarks them if they come back', async () => {
		const t = setup();
		const id = await t.upload('#123456');
		const [row] = mediaOf(t.db, id);
		const remote = t.fake.files.get(row!.ziplineId!)!;
		t.fake.files.delete(remote.id);
		await t.mementos!.run();
		expect(getItem(t.db, id)!.media[0]).toMatchObject({ gone: true, url: null });
		expect(t.mementos!.status().gone).toBe(1);

		t.fake.files.set(remote.id, remote);
		await t.mementos!.run();
		expect(getItem(t.db, id)!.media[0]!.gone).toBe(false);
	});

	it("doesn't mark anything gone when the list can't be read", async () => {
		const t = setup();
		const id = await t.upload('#654321');
		t.fake.down = true;
		await t.mementos!.sync().catch(() => null);
		expect(getItem(t.db, id)!.media[0]!.gone).toBe(false);
	});

	it('creates the Inbox again if she deleted it', async () => {
		const t = setup();
		const first = t.mementos!.inboxCollection();
		t.sqlite.prepare('DELETE FROM collections WHERE id = ?').run(first);
		expect(t.mementos!.inboxCollection()).not.toBe(first);
	});
});

describe('deleting', () => {
	it('keeps the Zipline file by default, and the sync leaves it alone', async () => {
		const t = setup();
		const id = await t.upload('#abcdef');
		const zipId = mediaOf(t.db, id)[0]!.ziplineId!;
		const result = await removeItems(t.services, [id], null);
		expect(result).toEqual({ deleted: 1, ziplineFailed: 0 });
		expect(t.fake.files.has(zipId)).toBe(true);
		expect(filesIn(join(t.dir, 'thumbs'))).toEqual([]);
		await t.mementos!.run();
		expect(listItems(t.db, {}, { limit: 50 }).items).toHaveLength(0);
	});

	it('deletes it on Zipline too when asked', async () => {
		const t = setup();
		const id = await t.upload('#fedcba');
		const zipId = mediaOf(t.db, id)[0]!.ziplineId!;
		await removeItems(t.services, [id], null, { alsoZipline: true });
		expect(t.fake.files.has(zipId)).toBe(false);
	});
});

describe('serving and exporting from Zipline', () => {
	it('streams a byte range through the Archive', async () => {
		const t = setup();
		const id = await t.upload('#0f0f0f');
		const [row] = mediaOf(t.db, id);
		const bytes = t.fake.files.get(row!.ziplineId!)!.bytes;
		const response = await proxyZipline(
			t.zipline!,
			{ ziplineId: row!.ziplineId!, ziplineName: row!.ziplineName, mime: row!.mime },
			new Request('http://archive.test/file/x', { headers: { range: 'bytes=2-9' } }),
			{ cacheControl: 'private' }
		);
		expect(response!.status).toBe(206);
		expect(response!.headers.get('content-range')).toBe(`bytes 2-9/${bytes.length}`);
		expect(response!.headers.get('content-type')).toBe('image/png');
		expect(Buffer.from(await response!.arrayBuffer()).equals(bytes.subarray(2, 10))).toBe(true);

		const cached = await proxyZipline(
			t.zipline!,
			{ ziplineId: row!.ziplineId!, ziplineName: null, mime: null },
			new Request('http://archive.test/file/x', {
				headers: { 'if-none-match': `"z-${row!.ziplineId}"` }
			}),
			{ cacheControl: 'private' }
		);
		expect(cached!.status).toBe(304);

		t.fake.files.clear();
		const gone = await proxyZipline(
			t.zipline!,
			{ ziplineId: row!.ziplineId!, ziplineName: row!.ziplineName, mime: null },
			new Request('http://archive.test/file/x'),
			{ cacheControl: 'private' }
		);
		expect(gone).toBeNull();
	});

	it('puts Zipline files in the .zip', async () => {
		const t = setup();
		const id = await t.upload('#aa00aa');
		const [row] = mediaOf(t.db, id);
		const bytes = t.fake.files.get(row!.ziplineId!)!.bytes;
		const zip = Buffer.from(
			await new Response(exportZip(t.db, t.storage, {}, 'Test')).arrayBuffer()
		);
		// Files are stored, not compressed, so the picture's bytes are in the zip as they are.
		expect(zip.includes(bytes)).toBe(true);
		expect(zip.includes(Buffer.from(`files/0001-${id}.png`))).toBe(true);
		expect(zip.includes(Buffer.from('captions.json'))).toBe(true);
	});
});

describe('against a real fake Zipline server', () => {
	it('saves, syncs and streams over HTTP', async () => {
		const fake = new FakeZipline({ noUserRaw: true });
		const { url, server } = await fake.listen();
		try {
			const t = setup({ fetch: (input, init) => fetch(input, init) });
			const zipline = new Zipline({ url: PUBLIC, internalUrl: url, token: fake.token });
			const storage = new Storage({ local: t.local, zipline, folder: 'Archive' });
			const services = { ...t.services, store: storage };
			const mementos = new Mementos({
				db: t.db,
				storage,
				zipline,
				syncMinutes: 5,
				inbox: 'Inbox',
				maxImportBytes: 5e6
			});
			const bytes = await picture('#13579b', 200, 100);
			const id = await saveUpload(
				services,
				{ bytes },
				{ owner: 'sae', collectionId: null, tags: 'net' }
			);
			const [row] = mediaOf(t.db, id);
			expect(row!.path).toBeNull();
			expect(row!.mirrorUrl).toBe(`${PUBLIC}/u/${row!.ziplineName}`);

			fake.addDirect('from-sharex.png', await picture('#2468ac'), 'image/png');
			await mementos.run();
			expect(mementos.status().connection.state).toBe('ok');
			expect(listItems(t.db, {}, { limit: 10 }).items).toHaveLength(2);

			const response = await proxyZipline(
				zipline,
				{ ziplineId: row!.ziplineId!, ziplineName: row!.ziplineName, mime: row!.mime },
				new Request('http://archive.test/file/x', { headers: { range: 'bytes=-16' } }),
				{ cacheControl: 'private' }
			);
			expect(response!.status).toBe(206);
			expect(Buffer.from(await response!.arrayBuffer()).equals(bytes.subarray(-16))).toBe(true);
			// Zipline before 4.3: the public /raw/<name> route answered instead.
			expect(fake.calls).toContain(`GET /raw/${row!.ziplineName}`);
		} finally {
			server.close();
		}
	});

	it('refuses Zipline v3 with a clear message', async () => {
		const t = setup({ v3: true });
		await t.mementos!.run();
		expect(t.mementos!.status().connection).toMatchObject({ state: 'error' });
		expect(t.mementos!.status().connection.error).toMatch(/Zipline v3/);
	});
});
