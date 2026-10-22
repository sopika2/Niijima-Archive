import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { sniff } from './magic.ts';
import { MediaRejected, MediaStore } from './store.ts';

const bytes = (...values: Array<number | string>) =>
	Buffer.concat(
		values.map((v) => (typeof v === 'string' ? Buffer.from(v, 'latin1') : Buffer.from([v])))
	);
const ftyp = (brand: string) => bytes(0, 0, 0, 0x18, 'ftyp', brand, 0, 0, 0, 0);

describe('magic bytes', () => {
	it('knows pictures, GIFs and videos by their first bytes', () => {
		expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe('image/jpeg');
		expect(sniff(bytes(0x89, 'PNG\r\n', 0x1a, '\n'))?.ext).toBe('png');
		expect(sniff(bytes('GIF89a', 1, 0))).toEqual({ mime: 'image/gif', ext: 'gif', kind: 'gif' });
		expect(sniff(bytes('GIF87a'))?.kind).toBe('gif');
		expect(sniff(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '))?.mime).toBe('image/webp');
		expect(sniff(ftyp('avif'))?.mime).toBe('image/avif');
		expect(sniff(ftyp('isom'))).toEqual({ mime: 'video/mp4', ext: 'mp4', kind: 'video' });
		expect(sniff(ftyp('qt  '))?.mime).toBe('video/quicktime');
		expect(sniff(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, 'webm'))?.mime).toBe(
			'video/webm'
		);
	});

	it('refuses everything else, whatever it is called', () => {
		expect(sniff(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
		expect(sniff(bytes('<!doctype html><script>'))).toBeNull();
		expect(sniff(bytes('%PDF-1.7'))).toBeNull();
		expect(sniff(bytes('PK', 3, 4))).toBeNull();
		expect(sniff(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull();
		expect(sniff(ftyp('heic'))).toBeNull();
		expect(sniff(bytes(0x1a, 0x45, 0xdf, 0xa3, 'matroska'))).toBeNull();
		expect(sniff(bytes(0xff, 0xd8))).toBeNull();
		expect(sniff(new Uint8Array())).toBeNull();
	});
});

describe('media store', () => {
	const root = mkdtempSync(join(tmpdir(), 'archive-media-'));
	const store = new MediaStore(root, 64);
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const when = new Date('2026-10-21T12:00:00Z');

	it('stores a picture under yyyy/mm with a WebP thumbnail', async () => {
		const png = await sharp({
			create: { width: 300, height: 200, channels: 3, background: '#d90416' }
		})
			.png()
			.toBuffer();
		const file = await store.save(png, { maxBytes: 1e6, now: when });
		expect(file.path).toMatch(/^2026\/10\/[a-z0-9]{20}\.png$/);
		expect(file).toMatchObject({ kind: 'image', mime: 'image/png', width: 300, height: 200 });
		expect(existsSync(join(root, file.path))).toBe(true);
		const thumb = await sharp(join(root, file.thumbPath!)).metadata();
		expect(thumb).toMatchObject({ format: 'webp', width: 64 });
	});

	it('gives an animated GIF a still thumbnail and keeps the animation', async () => {
		const frame = (colour: string) =>
			sharp({ create: { width: 40, height: 30, channels: 4, background: colour } })
				.raw()
				.toBuffer();
		const frames = Buffer.concat([await frame('#ff0000'), await frame('#0000ff')]);
		const gif = await sharp(frames, { raw: { width: 40, height: 60, channels: 4, pageHeight: 30 } })
			.gif({ loop: 0, delay: [100, 100] })
			.toBuffer();
		const file = await store.save(gif, { maxBytes: 1e6, now: when });
		expect(file).toMatchObject({ kind: 'gif', width: 40, height: 30 });
		expect((await sharp(join(root, file.path), { animated: true }).metadata()).pages).toBe(2);
		const thumb = await sharp(join(root, file.thumbPath!), { animated: true }).metadata();
		expect(thumb.pages ?? 1).toBe(1);
	});

	it('refuses wrong types, damaged pictures and files over the limit', async () => {
		await expect(store.save(Buffer.from('<svg/>'), { maxBytes: 1e6 })).rejects.toBeInstanceOf(
			MediaRejected
		);
		await expect(
			store.save(Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2]), { maxBytes: 1e6 })
		).rejects.toThrow(/damaged/);
		await expect(store.save(Buffer.alloc(2000, 1), { maxBytes: 1000 })).rejects.toThrow(/limit/);
	});

	it('only resolves paths inside the media folder', () => {
		expect(store.absolute('2026/10/abcdefghij1234567890.jpg')).toBe(
			join(root, '2026/10/abcdefghij1234567890.jpg')
		);
		expect(store.absolute('../secrets/abcdefghij.jpg')).toBeNull();
		expect(store.absolute('2026/10/../../x.jpg')).toBeNull();
		expect(store.absolute('2026/10/abcdefghij1234567890.html')).toBeNull();
	});
});
