import type { FetchLike } from './safe-fetch.ts';

/*
 * Mementos: the owner's Zipline (v4, github.com/diced/zipline). When it is set up it is where
 * every saved file lives; the Archive keeps the file's id, name and public link, and a small
 * thumbnail of its own. The API calls used, all with the user's token in `authorization`:
 *
 *   POST   /api/upload                    multipart "file"; x-zipline-folder: <folder id>
 *                                         → { files: [{ id, name, type, url }] }
 *   GET    /api/user/files?page&perpage   → { page: [file], total, pages }
 *   GET    /api/user/files/:idOrName      → file
 *   DELETE /api/user/files/:id            → file
 *   GET    /api/user/files/:id/raw        the bytes, with Range (v4.3 and later)
 *   GET    /raw/:name                     the bytes, with Range (every v4)
 *   GET    /api/user/folders?noincl=true  → [{ id, name }]
 *   POST   /api/user/folders { name }     → { id, name }
 *
 * where a file is { id, name, originalName, size, type, createdAt, folderId, url: "/u/<name>",
 * thumbnail: { path } | null, password }. Zipline v3 answered the file list with a bare array
 * and numeric ids; it is detected and refused with a clear message instead.
 */

export interface ZiplineOptions {
	/** The address she opens Mementos at; links shown to her are built on it. */
	readonly url: string;
	/** Where the Archive itself reaches Zipline (container to container); defaults to `url`. */
	readonly internalUrl?: string | null;
	readonly token: string;
	readonly fetchImpl?: FetchLike;
	readonly timeoutMs?: number;
}

/** Zipline said no (or didn't answer). `status` is 0 when it couldn't be reached. */
export class ZiplineError extends Error {
	override readonly name = 'ZiplineError';
	constructor(
		message: string,
		readonly status = 0,
		/** Worth trying again later: unreachable, busy (429) or a server error. */
		readonly transient = status === 0 || status === 429 || status >= 500,
		/** Seconds Zipline asked us to wait (429). */
		readonly retryAfter: number | null = null
	) {
		super(message);
	}
}

/** A file on Zipline, as the Archive uses it. */
export interface ZiplineFile {
	readonly id: string;
	readonly name: string;
	readonly originalName: string | null;
	readonly size: number;
	readonly type: string;
	readonly createdAt: string;
	readonly folderId: string | null;
	/** The public link (https://mementos…/u/<name>). */
	readonly url: string;
	/** Zipline's own thumbnail (videos), by name: .thumbnail.<id>.jpg */
	readonly thumbnail: string | null;
	readonly password: boolean;
}

export interface Uploaded {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	/** The public link. */
	readonly url: string;
}

const trim = (url: string) => url.replace(/\/+$/, '');

function message(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null;
	const value =
		(body as { error?: unknown }).error ?? (body as { message?: unknown }).message ?? null;
	return typeof value === 'string' ? value : null;
}

/** Reads one file entry; null when it isn't shaped like a v4 file. */
export function readFile(raw: unknown, publicUrl: string): ZiplineFile | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const file = raw as Record<string, unknown>;
	if (typeof file.id !== 'string' || typeof file.name !== 'string') return null;
	const size = typeof file.size === 'number' ? file.size : Number(file.size);
	const created =
		typeof file.createdAt === 'string' ? new Date(file.createdAt) : new Date(Number.NaN);
	const thumb = file.thumbnail as { path?: unknown } | null | undefined;
	const link = typeof file.url === 'string' ? file.url : `/u/${encodeURIComponent(file.name)}`;
	return {
		id: file.id,
		name: file.name,
		originalName: typeof file.originalName === 'string' ? file.originalName : null,
		size: Number.isFinite(size) ? size : 0,
		type: typeof file.type === 'string' ? file.type : 'application/octet-stream',
		createdAt: Number.isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString(),
		folderId: typeof file.folderId === 'string' ? file.folderId : null,
		url: publicLink(publicUrl, link),
		thumbnail: thumb && typeof thumb.path === 'string' ? thumb.path : null,
		password: file.password === true
	};
}

/**
 * The link as she should see it. Zipline builds upload links from the Host it was called on
 * (http://zipline:3000 from inside Docker), so only the path is kept and put on the public URL.
 */
export function publicLink(publicUrl: string, link: string): string {
	const parsed = new URL(link, 'http://zipline.invalid');
	return `${trim(publicUrl)}${parsed.pathname}${parsed.search}`;
}

/** The name in a /u/<name> link, for matching links saved before the Archive kept ids. */
export function nameFromLink(link: string | null): string | null {
	if (!link) return null;
	try {
		const last = new URL(link).pathname.split('/').filter(Boolean).pop();
		return last ? decodeURIComponent(last) : null;
	} catch {
		return null;
	}
}

export class Zipline {
	readonly url: string;
	readonly internalUrl: string;
	private readonly token: string;
	private readonly fetchImpl: FetchLike;
	private readonly timeoutMs: number;
	/** Set once /api/user/files/:id/raw turned out not to exist (Zipline before v4.3). */
	private legacyRaw = false;

	constructor(options: ZiplineOptions) {
		this.url = trim(options.url);
		this.internalUrl = trim(options.internalUrl || options.url);
		this.token = options.token;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.timeoutMs = options.timeoutMs ?? 30_000;
	}

	private async request(
		path: string,
		init: RequestInit & { timeoutMs?: number } = {}
	): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set('authorization', this.token);
		const timeout = AbortSignal.timeout(init.timeoutMs ?? this.timeoutMs);
		try {
			return await this.fetchImpl(`${this.internalUrl}${path}`, {
				...init,
				headers,
				signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
			});
		} catch (error) {
			if (init.signal?.aborted) throw error;
			const reason =
				error instanceof Error && error.name === 'TimeoutError'
					? 'it took too long to answer'
					: 'it could not be reached';
			throw new ZiplineError(`Mementos (${this.internalUrl}) did not answer: ${reason}.`);
		}
	}

	private async json(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
		const response = await this.request(path, {
			...init,
			headers: { accept: 'application/json', ...(init.headers as Record<string, string>) }
		});
		const body = await response.json().catch(() => null);
		if (!response.ok) throw this.refusal(response, body);
		return body as unknown;
	}

	private refusal(response: Response, body: unknown): ZiplineError {
		const reason = message(body);
		const retry = Number(response.headers.get('retry-after'));
		const hint =
			response.status === 401 || response.status === 403
				? ' Check ZIPLINE_TOKEN (Zipline → your name, top right → Copy token).'
				: '';
		return new ZiplineError(
			`Mementos answered ${response.status}${reason ? `: ${reason}` : ''}.${hint}`,
			response.status,
			undefined,
			Number.isFinite(retry) && retry > 0 ? retry : null
		);
	}

	/**
	 * Checks the token and that this is Zipline v4. Throws ZiplineError with something she can
	 * act on otherwise.
	 */
	async check(): Promise<{ files: number }> {
		const body = await this.json('/api/user/files?page=1&perpage=1');
		if (Array.isArray(body))
			throw new ZiplineError(
				'Mementos runs Zipline v3. The Archive needs Zipline v4: update it (https://zipline.diced.sh/docs/migrate).',
				200,
				false
			);
		const page = (body as { page?: unknown } | null)?.page;
		if (!Array.isArray(page))
			throw new ZiplineError(
				"That address doesn't answer like Zipline v4. Check ZIPLINE_URL and ZIPLINE_INTERNAL_URL.",
				200,
				false
			);
		return { files: Number((body as { total?: unknown }).total) || page.length };
	}

	/** Uploads one file. `folderId` puts it in a Zipline folder. */
	async upload(
		data: Blob | Buffer,
		file: { name: string; mime: string; folderId?: string | null }
	): Promise<Uploaded> {
		const send = async (neverExpire: boolean) => {
			const form = new FormData();
			const blob =
				data instanceof Blob
					? data
					: new Blob([data as Uint8Array<ArrayBuffer>], { type: file.mime });
			form.append('file', blob, file.name);
			const headers: Record<string, string> = { accept: 'application/json' };
			if (file.folderId) headers['x-zipline-folder'] = file.folderId;
			// A Zipline with a default expiry would otherwise delete her saves one day.
			if (neverExpire) headers['x-zipline-deletes-at'] = 'never';
			return this.request('/api/upload', {
				method: 'POST',
				headers,
				body: form,
				timeoutMs: Math.max(this.timeoutMs, 300_000)
			});
		};
		let response = await send(true);
		let body = await response.json().catch(() => null);
		// A Zipline with a maximum expiry refuses "never"; then its own default applies.
		if (response.status === 400 && /deletes-at/i.test(message(body) ?? '')) {
			response = await send(false);
			body = await response.json().catch(() => null);
		}
		if (!response.ok) throw this.refusal(response, body);
		const first = (body as { files?: unknown[] } | null)?.files?.[0];
		if (typeof first === 'string')
			throw new ZiplineError(
				'Mementos runs Zipline v3. The Archive needs Zipline v4.',
				response.status,
				false
			);
		const entry = first as Record<string, unknown> | undefined;
		if (!entry || typeof entry.id !== 'string' || typeof entry.url !== 'string')
			throw new ZiplineError('Mementos answered the upload without a file.', response.status);
		return {
			id: entry.id,
			name: typeof entry.name === 'string' ? entry.name : (nameFromLink(entry.url) ?? file.name),
			type: typeof entry.type === 'string' ? entry.type : file.mime,
			url: publicLink(this.url, entry.url)
		};
	}

	/** One file by id or name; null when Zipline doesn't have it. */
	async file(idOrName: string): Promise<ZiplineFile | null> {
		try {
			const body = await this.json(`/api/user/files/${encodeURIComponent(idOrName)}`);
			return readFile(body, this.url);
		} catch (error) {
			if (error instanceof ZiplineError && (error.status === 404 || error.status === 400))
				return null;
			throw error;
		}
	}

	/** One page of her files, oldest first. */
	async page(page: number, perpage = 100): Promise<{ files: ZiplineFile[]; pages: number }> {
		const body = await this.json(
			`/api/user/files?page=${page}&perpage=${perpage}&sortBy=createdAt&order=asc&filter=all`
		);
		if (Array.isArray(body))
			throw new ZiplineError('Mementos runs Zipline v3. The Archive needs Zipline v4.', 200, false);
		const raw = (body as { page?: unknown }).page;
		if (!Array.isArray(raw)) throw new ZiplineError('Mementos sent an odd file list.', 200);
		const files = raw
			.map((entry) => readFile(entry, this.url))
			.filter((file): file is ZiplineFile => file !== null);
		const pages = Number((body as { pages?: unknown }).pages);
		return {
			files,
			pages: Number.isFinite(pages) ? pages : files.length < perpage ? page : page + 1
		};
	}

	/** Every one of her files. Throws if any page fails, so a partial list is never mistaken. */
	async all(perpage = 100): Promise<ZiplineFile[]> {
		const files: ZiplineFile[] = [];
		const seen = new Set<string>();
		for (let page = 1; page <= 10_000; page++) {
			const result = await this.page(page, perpage);
			for (const file of result.files) {
				if (!seen.has(file.id)) files.push(file);
				seen.add(file.id);
			}
			if (result.files.length === 0 || page >= result.pages) break;
		}
		return files;
	}

	/**
	 * The file's bytes (status 200, 206 or 416), passing Range along. Uses the signed-in raw
	 * route so password-protected files work too, and /raw/<name> on Zipline before v4.3.
	 */
	async raw(
		file: { id: string; name: string | null },
		init: { range?: string | null; signal?: AbortSignal; timeoutMs?: number } = {}
	): Promise<Response> {
		const headers: Record<string, string> = {};
		if (init.range) headers.range = init.range;
		const options = { headers, signal: init.signal, timeoutMs: init.timeoutMs ?? 600_000 };
		if (!this.legacyRaw) {
			const response = await this.request(
				`/api/user/files/${encodeURIComponent(file.id)}/raw`,
				options
			);
			if (response.status !== 404 || !file.name) return response;
			await response.body?.cancel();
			const fallback = await this.request(`/raw/${encodeURIComponent(file.name)}`, options);
			if (fallback.ok) this.legacyRaw = true;
			return fallback;
		}
		return this.request(`/raw/${encodeURIComponent(file.name ?? file.id)}`, options);
	}

	/** Deletes a file on Zipline. Already gone counts as done. */
	async remove(id: string): Promise<void> {
		const response = await this.request(`/api/user/files/${encodeURIComponent(id)}`, {
			method: 'DELETE'
		});
		const body = await response.json().catch(() => null);
		if (!response.ok && response.status !== 404) throw this.refusal(response, body);
	}

	/** The id of her folder called `name`, made if it isn't there. */
	async folder(name: string): Promise<string> {
		const list = await this.json('/api/user/folders?noincl=true');
		const found = Array.isArray(list)
			? (list as Array<{ id?: unknown; name?: unknown }>).find(
					(folder) =>
						typeof folder.name === 'string' && folder.name.toLowerCase() === name.toLowerCase()
				)
			: undefined;
		if (found && typeof found.id === 'string') return found.id;
		const made = (await this.json('/api/user/folders', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		})) as { id?: unknown } | null;
		if (!made || typeof made.id !== 'string')
			throw new ZiplineError('Mementos made the folder without an id.', 200);
		return made.id;
	}
}
