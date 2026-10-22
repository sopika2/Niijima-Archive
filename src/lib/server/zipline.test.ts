import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nameFromLink, publicLink, readFile, Zipline, ZiplineError } from './zipline.ts';

const fixtures = new URL('../../../tests/fixtures/zipline/', import.meta.url);
const recorded = (name: string) => readFileSync(new URL(name, fixtures), 'utf8');
const PUBLIC = 'https://mementos.niijimasisters.com';

interface Seen {
	url: string;
	method: string;
	headers: Headers;
	body: unknown;
}

/** A Zipline that answers from a list of recorded responses, keeping what it was sent. */
function recordedZipline(answers: Array<() => Response>) {
	const seen: Seen[] = [];
	const zipline = new Zipline({
		url: `${PUBLIC}/`,
		internalUrl: 'http://zipline:3000',
		token: 'zip-token',
		fetchImpl: async (url, init) => {
			seen.push({
				url,
				method: init?.method ?? 'GET',
				headers: new Headers(init?.headers),
				body: init?.body
			});
			const next = answers.shift();
			if (!next) throw new Error(`no answer recorded for ${url}`);
			return next();
		}
	});
	return { zipline, seen };
}
const jsonAnswer =
	(text: string, status = 200, headers: Record<string, string> = {}) =>
	() =>
		new Response(text, { status, headers: { 'content-type': 'application/json', ...headers } });

describe('Zipline v4 answers', () => {
	it('reads a file entry and puts its link on the public address', () => {
		const page = JSON.parse(recorded('files-page-v4.json')) as { page: unknown[] };
		expect(readFile(page.page[0], PUBLIC)).toEqual({
			id: 'cmgx2k1hz0003s60l8u6v2f1a',
			name: 'kQ3x9a.png',
			originalName: null,
			size: 48213,
			type: 'image/png',
			createdAt: '2026-10-20T08:15:42.120Z',
			folderId: 'cmgx2jz7e0001s60lq0a1b2c3',
			url: `${PUBLIC}/u/kQ3x9a.png`,
			thumbnail: null,
			password: false
		});
		expect(readFile(page.page[1], PUBLIC)).toMatchObject({
			name: 'beach clip.mp4',
			url: `${PUBLIC}/u/beach%20clip.mp4`,
			thumbnail: '.thumbnail.cmgx3m9pq0007s60l1d4e5f6g.jpg',
			password: true
		});
		expect(readFile({ id: 12, name: 'abc.png' }, PUBLIC)).toBeNull();
		expect(readFile(null, PUBLIC)).toBeNull();
	});

	it('builds links from the public address, never the internal one', () => {
		expect(publicLink(PUBLIC, 'http://zipline:3000/u/kQ3x9a.png')).toBe(`${PUBLIC}/u/kQ3x9a.png`);
		expect(publicLink(`${PUBLIC}/`, '/u/a%20b.png')).toBe(`${PUBLIC}/u/a%20b.png`);
		expect(nameFromLink(`${PUBLIC}/u/a%20b.png`)).toBe('a b.png');
		expect(nameFromLink('not a link')).toBeNull();
		expect(nameFromLink(null)).toBeNull();
	});
});

describe('Zipline client', () => {
	it('uploads to the internal address with the token, folder and no expiry', async () => {
		const { zipline, seen } = recordedZipline([
			jsonAnswer(recorded('upload-v4.json')),
			jsonAnswer(recorded('folders-v4.json'))
		]);
		const uploaded = await zipline.upload(Buffer.from('png bytes'), {
			name: 'abc.png',
			mime: 'image/png',
			folderId: 'cmgx2jz7e0001s60lq0a1b2c3'
		});
		expect(uploaded).toEqual({
			id: 'cmgx2k1hz0003s60l8u6v2f1a',
			name: 'kQ3x9a.png',
			type: 'image/png',
			url: `${PUBLIC}/u/kQ3x9a.png`
		});
		const call = seen[0]!;
		expect(call.url).toBe('http://zipline:3000/api/upload');
		expect(call.method).toBe('POST');
		expect(call.headers.get('authorization')).toBe('zip-token');
		expect(call.headers.get('x-zipline-folder')).toBe('cmgx2jz7e0001s60lq0a1b2c3');
		expect(call.headers.get('x-zipline-deletes-at')).toBe('never');
		const file = (call.body as FormData).get('file') as File;
		expect(file.name).toBe('abc.png');
		expect(file.type).toBe('image/png');
		expect(await file.text()).toBe('png bytes');
	});

	it('uploads again without "never" when Zipline has a maximum expiry', async () => {
		const { zipline, seen } = recordedZipline([
			jsonAnswer(
				'{"error":"E1001: bad options[x-zipline-deletes-at]: Expiry exceeds maximum allowed expiration of 30d","code":1001,"statusCode":400}',
				400
			),
			jsonAnswer(recorded('upload-v4.json'))
		]);
		await zipline.upload(Buffer.from('x'), { name: 'a.png', mime: 'image/png' });
		expect(seen.map((call) => call.headers.get('x-zipline-deletes-at'))).toEqual(['never', null]);
	});

	it('explains a refused token and a busy Zipline', async () => {
		const { zipline } = recordedZipline([
			jsonAnswer(recorded('error-401.json'), 401),
			jsonAnswer('{"error":"Rate limit exceeded"}', 429, { 'retry-after': '42' })
		]);
		await expect(zipline.check()).rejects.toThrow(/401: E2001: Invalid token.*Copy token/);
		const busy = await zipline
			.upload(Buffer.from('x'), { name: 'a.png', mime: 'image/png' })
			.catch((error: ZiplineError) => error);
		expect(busy).toMatchObject({ status: 429, transient: true, retryAfter: 42 });
	});

	it('recognises Zipline v3 and says so', async () => {
		const { zipline } = recordedZipline([
			jsonAnswer(recorded('files-v3.json')),
			jsonAnswer(recorded('upload-v3.json'))
		]);
		await expect(zipline.check()).rejects.toThrow(/Zipline v3.*needs Zipline v4/);
		await expect(
			zipline.upload(Buffer.from('x'), { name: 'a.png', mime: 'image/png' })
		).rejects.toThrow(/v3/);
	});

	it('refuses something that is not Zipline', async () => {
		const { zipline } = recordedZipline([jsonAnswer('{"hello":"world"}')]);
		await expect(zipline.check()).rejects.toThrow(/doesn't answer like Zipline v4/);
	});

	it('says when Zipline cannot be reached', async () => {
		const zipline = new Zipline({
			url: PUBLIC,
			token: 't',
			fetchImpl: async () => {
				throw new TypeError('fetch failed');
			}
		});
		await expect(zipline.check()).rejects.toMatchObject({ status: 0, transient: true });
	});

	it('lists every page of her files, oldest first', async () => {
		const page = JSON.parse(recorded('files-page-v4.json'));
		const second = {
			page: [{ ...page.page[0], id: 'third', name: 'third.gif', type: 'image/gif' }],
			total: 3,
			pages: 2
		};
		const { zipline, seen } = recordedZipline([
			jsonAnswer(JSON.stringify(page)),
			jsonAnswer(JSON.stringify(second))
		]);
		const files = await zipline.all(2);
		expect(files.map((file) => file.name)).toEqual(['kQ3x9a.png', 'beach clip.mp4', 'third.gif']);
		expect(seen.map((call) => new URL(call.url).search)).toEqual([
			'?page=1&perpage=2&sortBy=createdAt&order=asc&filter=all',
			'?page=2&perpage=2&sortBy=createdAt&order=asc&filter=all'
		]);
	});

	it('reads raw bytes through the signed-in route, falling back to /raw/<name>', async () => {
		const { zipline, seen } = recordedZipline([
			() => new Response('Not Found', { status: 404 }),
			() => new Response('ab', { status: 206, headers: { 'content-range': 'bytes 0-1/9' } }),
			() => new Response('cd', { status: 206 })
		]);
		const first = await zipline.raw({ id: 'id1', name: 'a b.png' }, { range: 'bytes=0-1' });
		expect(first.status).toBe(206);
		await zipline.raw({ id: 'id2', name: 'c.png' }, { range: 'bytes=2-3' });
		expect(seen.map((call) => [call.url, call.headers.get('range')])).toEqual([
			['http://zipline:3000/api/user/files/id1/raw', 'bytes=0-1'],
			['http://zipline:3000/raw/a%20b.png', 'bytes=0-1'],
			// Remembered: this Zipline has no signed-in raw route.
			['http://zipline:3000/raw/c.png', 'bytes=2-3']
		]);
	});

	it('finds or makes the Archive folder, and deletes files', async () => {
		const { zipline, seen } = recordedZipline([
			jsonAnswer(recorded('folders-v4.json')),
			jsonAnswer('[]'),
			jsonAnswer('{"id":"new-folder","name":"Archive"}'),
			jsonAnswer('{"error":"E4000: File not found","code":4000,"statusCode":404}', 404),
			jsonAnswer('{"error":"E9000","statusCode":500}', 500)
		]);
		expect(await zipline.folder('archive')).toBe('cmgx2jz7e0001s60lq0a1b2c3');
		expect(await zipline.folder('Archive')).toBe('new-folder');
		expect(JSON.parse(String(seen[2]!.body))).toEqual({ name: 'Archive' });
		await expect(zipline.remove('gone-already')).resolves.toBeUndefined();
		await expect(zipline.remove('x')).rejects.toBeInstanceOf(ZiplineError);
		expect(seen[3]!.method).toBe('DELETE');
	});

	it('looks a file up by id or name and treats a 404 as absent', async () => {
		const page = JSON.parse(recorded('files-page-v4.json'));
		const { zipline } = recordedZipline([
			jsonAnswer(JSON.stringify(page.page[0])),
			jsonAnswer('{"error":"E4000: File not found","code":4000,"statusCode":404}', 404)
		]);
		expect((await zipline.file('kQ3x9a.png'))?.size).toBe(48213);
		expect(await zipline.file('nope')).toBeNull();
	});
});
