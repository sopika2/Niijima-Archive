/**
 * A small stand-in for Zipline v4, enough of its API for the Archive: upload, the file list
 * with paging, one file, delete, the raw routes with byte ranges, and folders. Its answers are
 * shaped like Zipline 4.8's (src/server/routes in github.com/diced/zipline). Used by the tests
 * in-process, and as a real server for trying the app by hand:
 *
 *   node scripts/fake-zipline.ts   (then ZIPLINE_URL=http://localhost:3999 ZIPLINE_TOKEN=fake-token)
 */
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';

export interface FakeFile {
	id: string;
	name: string;
	originalName: string | null;
	size: number;
	type: string;
	createdAt: string;
	folderId: string | null;
	bytes: Buffer;
	thumbnail: { path: string; bytes: Buffer } | null;
	deletesAt: string | null;
}

export interface FakeOptions {
	token?: string;
	/** Answer like Zipline v3 (bare arrays, string links). */
	v3?: boolean;
	/** Like Zipline before 4.3: no /api/user/files/:id/raw. */
	noUserRaw?: boolean;
	/** Change what is stored, like Zipline's "remove GPS metadata" does. */
	mutate?: (bytes: Buffer) => Buffer;
	/** Refuse x-zipline-deletes-at: never, like a Zipline with a maximum expiry. */
	maxExpiration?: boolean;
}

const id = () => randomBytes(12).toString('hex').slice(0, 25);
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' }
	});
const apiError = (status: number, message: string) =>
	json({ error: message, statusCode: status }, status);

export class FakeZipline {
	readonly token: string;
	readonly options: FakeOptions;
	readonly files = new Map<string, FakeFile>();
	readonly folders = new Map<string, { id: string; name: string }>();
	/** Every request, as "METHOD /path". */
	readonly calls: string[] = [];
	/** Uploads to refuse (status), one per upload, before taking any. */
	failNext: number[] = [];
	/** Answer the next request with 503, as if the container were restarting. */
	down = false;
	private clock = Date.parse('2026-10-01T10:00:00Z');

	constructor(options: FakeOptions = {}) {
		this.options = options;
		this.token = options.token ?? 'fake-token';
	}

	/** A file she uploaded to Zipline herself (phone, ShareX). */
	addDirect(
		name: string,
		bytes: Buffer,
		type: string,
		extra: Partial<Pick<FakeFile, 'thumbnail' | 'folderId'>> = {}
	): FakeFile {
		const file: FakeFile = {
			id: id(),
			name,
			originalName: name,
			size: bytes.length,
			type,
			createdAt: new Date((this.clock += 60_000)).toISOString(),
			folderId: extra.folderId ?? null,
			bytes,
			thumbnail: extra.thumbnail ?? null,
			deletesAt: null
		};
		this.files.set(file.id, file);
		return file;
	}

	private view(file: FakeFile) {
		return {
			id: file.id,
			createdAt: file.createdAt,
			updatedAt: file.createdAt,
			deletesAt: file.deletesAt,
			name: file.name,
			originalName: file.originalName,
			size: file.size,
			type: file.type,
			views: 0,
			favorite: false,
			password: false,
			anonymous: false,
			folderId: file.folderId,
			thumbnail: file.thumbnail ? { path: file.thumbnail.path } : null,
			tags: [],
			url: `/u/${encodeURIComponent(file.name)}`
		};
	}

	private find(key: string): FakeFile | null {
		const decoded = decodeURIComponent(key);
		for (const file of this.files.values())
			if (file.id === decoded || file.name === decoded) return file;
		return null;
	}

	private raw(bytes: Buffer, type: string, range: string | null): Response {
		const size = bytes.length;
		if (range) {
			const match = /^bytes=(\d*)-(\d*)$/.exec(range);
			let start = match?.[1] ? Number(match[1]) : NaN;
			let end = match?.[2] ? Number(match[2]) : size - 1;
			if (match && !match[1] && match[2]) {
				start = size - Number(match[2]);
				end = size - 1;
			}
			if (!match || Number.isNaN(start) || start >= size || start > end)
				return new Response(null, {
					status: 416,
					headers: { 'content-range': `bytes */${size}`, 'content-length': '0' }
				});
			end = Math.min(end, size - 1);
			return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
				status: 206,
				headers: {
					'content-type': type,
					'content-range': `bytes ${start}-${end}/${size}`,
					'accept-ranges': 'bytes',
					'content-length': String(end - start + 1)
				}
			});
		}
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': type,
				'accept-ranges': 'bytes',
				'content-length': String(size)
			}
		});
	}

	private thumbnail(path: string): FakeFile['thumbnail'] {
		for (const file of this.files.values())
			if (file.thumbnail?.path === decodeURIComponent(path)) return file.thumbnail;
		return null;
	}

	/** Answers one request the way Zipline would. */
	handle = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const path = url.pathname;
		this.calls.push(`${request.method} ${path}`);
		if (this.down) return apiError(503, 'Service Unavailable');

		// The public raw route needs no token.
		const publicRaw = /^\/raw\/([^/]+)$/.exec(path);
		if (publicRaw && request.method === 'GET') {
			const thumb = this.thumbnail(publicRaw[1]!);
			if (thumb) return this.raw(thumb.bytes, 'image/jpeg', null);
			const file = this.find(publicRaw[1]!);
			if (!file || file.name !== decodeURIComponent(publicRaw[1]!))
				return new Response('Not Found', { status: 404 });
			return this.raw(file.bytes, file.type, request.headers.get('range'));
		}

		if (request.headers.get('authorization') !== this.token) return apiError(401, 'Not authorized');

		if (path === '/api/upload' && request.method === 'POST') {
			const refuse = this.failNext.shift();
			if (refuse) return apiError(refuse, refuse === 429 ? 'Rate limit exceeded' : 'Nope');
			if (this.options.maxExpiration && request.headers.get('x-zipline-deletes-at') === 'never')
				return apiError(
					400,
					'bad options[x-zipline-deletes-at]: Expiry exceeds maximum allowed expiration of 30d'
				);
			const form = await request.formData();
			const upload = form.get('file');
			if (!(upload instanceof File)) return apiError(400, 'No files found in request');
			const folder = request.headers.get('x-zipline-folder');
			if (folder && !this.folders.has(folder)) return apiError(404, 'Folder not found');
			const original = Buffer.from(await upload.arrayBuffer());
			const bytes = this.options.mutate ? this.options.mutate(original) : original;
			const ext = upload.name.includes('.') ? upload.name.slice(upload.name.lastIndexOf('.')) : '';
			const file: FakeFile = {
				id: id(),
				name: `${randomBytes(4).toString('hex').slice(0, 6)}${ext}`,
				originalName: null,
				size: bytes.length,
				type: upload.type || 'application/octet-stream',
				createdAt: new Date((this.clock += 60_000)).toISOString(),
				folderId: folder,
				bytes,
				thumbnail: null,
				deletesAt: null
			};
			this.files.set(file.id, file);
			// Built from the Host it was called on, like Zipline without a default domain.
			const link = `${url.origin}/u/${file.name}`;
			if (this.options.v3) return json({ files: [link] });
			return json({ files: [{ id: file.id, name: file.name, type: file.type, url: link }] });
		}

		if (path === '/api/user/files' && request.method === 'GET') {
			const all = [...this.files.values()];
			if (this.options.v3)
				return json(all.map((file) => ({ ...this.view(file), id: 1, mimetype: file.type })));
			const page = Number(url.searchParams.get('page'));
			if (!page) return apiError(400, 'Invalid request schema');
			const perpage = Number(url.searchParams.get('perpage') ?? 15);
			const order = url.searchParams.get('order') ?? 'desc';
			all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) * (order === 'asc' ? 1 : -1));
			return json({
				page: all.slice((page - 1) * perpage, page * perpage).map((file) => this.view(file)),
				total: all.length,
				pages: Math.ceil(all.length / perpage)
			});
		}

		const userRaw = /^\/api\/user\/files\/([^/]+)\/raw$/.exec(path);
		if (userRaw && request.method === 'GET') {
			if (this.options.noUserRaw) return new Response('Not Found', { status: 404 });
			const thumb = this.thumbnail(userRaw[1]!);
			if (thumb) return this.raw(thumb.bytes, 'image/jpeg', null);
			const file = this.find(userRaw[1]!);
			if (!file) return apiError(404, 'Not found');
			return this.raw(file.bytes, file.type, request.headers.get('range'));
		}

		const one = /^\/api\/user\/files\/([^/]+)$/.exec(path);
		if (one) {
			const file = this.find(one[1]!);
			if (!file) return apiError(404, 'File not found');
			if (request.method === 'GET') return json(this.view(file));
			if (request.method === 'DELETE') {
				this.files.delete(file.id);
				return json(this.view(file));
			}
		}

		if (path === '/api/user/folders' && request.method === 'GET')
			return json([...this.folders.values()].map((folder) => ({ ...folder, public: false })));
		if (path === '/api/user/folders' && request.method === 'POST') {
			const body = (await request.json()) as { name?: string };
			const folder = { id: id(), name: String(body.name) };
			this.folders.set(folder.id, folder);
			return json({ ...folder, public: false });
		}

		return apiError(404, 'Not found');
	};

	/** A fetch that answers from this fake, for tests that don't need a socket. */
	fetch = (input: string, init?: RequestInit): Promise<Response> =>
		this.handle(new Request(input, init));

	/** Serves the fake on a real port. */
	listen(port = 0): Promise<{ url: string; server: Server }> {
		const server = createServer(async (req, res) => {
			try {
				const body =
					req.method === 'GET' || req.method === 'HEAD'
						? undefined
						: (Readable.toWeb(req) as unknown as ReadableStream);
				const request = new Request(`http://${req.headers.host}${req.url}`, {
					method: req.method,
					headers: req.headers as Record<string, string>,
					body,
					duplex: 'half'
				} as RequestInit);
				const response = await this.handle(request);
				res.writeHead(response.status, Object.fromEntries(response.headers));
				if (response.body) {
					for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>)
						res.write(chunk);
				}
				res.end();
			} catch (error) {
				res.writeHead(500, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: String(error) }));
			}
		});
		return new Promise((done) =>
			server.listen(port, '127.0.0.1', () => {
				const address = server.address();
				const actual = typeof address === 'object' && address ? address.port : port;
				done({ url: `http://127.0.0.1:${actual}`, server });
			})
		);
	}
}
