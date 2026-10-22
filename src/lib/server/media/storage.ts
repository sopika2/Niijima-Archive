import { createHash } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Zipline, ZiplineError } from '../zipline.ts';
import type { MediaKind } from '../db/schema.ts';
import type { MediaStore, PreparedFile } from './store.ts';

/** Where a saved file ended up, in the shape of the media table's columns. */
export interface SavedFile {
	readonly id: string;
	readonly kind: MediaKind;
	readonly mime: string;
	readonly bytes: number;
	readonly width: number | null;
	readonly height: number | null;
	readonly thumbPath: string | null;
	/** On the Archive's disk (relative to data/media), or null when only Zipline has it. */
	readonly path: string | null;
	readonly ziplineId: string | null;
	readonly ziplineName: string | null;
	readonly mirrorUrl: string | null;
	readonly keepLocal: boolean;
	readonly storageNote: string | null;
}

export interface StorageOptions {
	readonly local: MediaStore;
	readonly zipline?: Zipline | null;
	/** The Zipline folder new files go in ("Archive"); null for none. */
	readonly folder?: string | null;
	readonly log?: (message: string) => void;
}

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function sha256File(path: string): Promise<string> {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest('hex');
}

/** Reads a response body, hashing it, without keeping it. */
export async function sha256Response(response: Response): Promise<{ hash: string; bytes: number }> {
	const hash = createHash('sha256');
	let bytes = 0;
	if (response.body) {
		for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
			hash.update(chunk);
			bytes += chunk.byteLength;
		}
	}
	return { hash: hash.digest('hex'), bytes };
}

/**
 * The one place files are put. Without Zipline everything stays on disk as before. With it,
 * each original goes to Zipline and only its thumbnail stays here; if Zipline can't take it
 * right now the original is kept on disk and the migration uploads it later, so nothing is
 * ever lost on the way.
 */
export class Storage {
	readonly local: MediaStore;
	readonly zipline: Zipline | null;
	private readonly folderName: string | null;
	private folderId: Promise<string | null> | null = null;
	private readonly log: (message: string) => void;
	private readonly inflight = new Set<Promise<unknown>>();
	private readonly migrating = new Map<string, Promise<MigrateResult>>();

	constructor(options: StorageOptions) {
		this.local = options.local;
		this.zipline = options.zipline ?? null;
		this.folderName = options.folder ?? null;
		this.log = options.log ?? (() => {});
	}

	get mode(): 'zipline' | 'local' {
		return this.zipline ? 'zipline' : 'local';
	}

	/** Waits for uploads in flight, so the sync never mistakes one for her own upload. */
	async settled(): Promise<void> {
		while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
	}

	private track<T>(work: Promise<T>): Promise<T> {
		this.inflight.add(work);
		void work.finally(() => this.inflight.delete(work)).catch(() => {});
		return work;
	}

	/** The id of the Zipline folder for the Archive's files; null when there is none. */
	private folder(): Promise<string | null> {
		if (!this.zipline || !this.folderName) return Promise.resolve(null);
		this.folderId ??= this.zipline.folder(this.folderName).catch((error) => {
			this.log(
				`no "${this.folderName}" folder on Mementos, uploading without one: ${String(error)}`
			);
			this.folderId = null;
			return null;
		});
		return this.folderId;
	}

	/** Checks, thumbnails and stores a file. Throws MediaRejected for files the Archive refuses. */
	async save(
		bytes: Buffer,
		options: { maxBytes: number; now?: Date; id?: string }
	): Promise<SavedFile> {
		const prepared = await this.local.prepare(bytes, options);
		if (!this.zipline) {
			await this.local.writeOriginal(prepared.path, bytes);
			return saved(prepared, { path: prepared.path });
		}
		return this.track(this.toZipline(prepared, bytes));
	}

	private async toZipline(prepared: PreparedFile, bytes: Buffer): Promise<SavedFile> {
		const zipline = this.zipline!;
		let uploaded;
		try {
			uploaded = await zipline.upload(bytes, {
				name: prepared.name,
				mime: prepared.mime,
				folderId: await this.folder()
			});
		} catch (error) {
			// Kept on disk; the migration tries again later.
			await this.local.writeOriginal(prepared.path, bytes);
			const note = error instanceof Error ? error.message : String(error);
			this.log(`kept ${prepared.name} on disk for now: ${note}`);
			return saved(prepared, { path: prepared.path, storageNote: note });
		}
		const remote = await zipline.file(uploaded.id).catch(() => null);
		const zip = {
			ziplineId: uploaded.id,
			ziplineName: remote?.name ?? uploaded.name,
			mirrorUrl: remote?.url ?? uploaded.url
		};
		if (remote && remote.size === bytes.length) return saved(prepared, { path: null, ...zip });
		// Zipline changed the file (it can strip GPS data or compress pictures), or didn't say:
		// the original stays here for good, and Mementos has its own copy.
		await this.local.writeOriginal(prepared.path, bytes);
		const note = remote
			? `Mementos keeps a changed copy (${remote.size} bytes, not ${bytes.length}); the original stays on the Archive's disk.`
			: "Mementos didn't confirm the upload; the original stays on the Archive's disk.";
		return saved(prepared, {
			path: prepared.path,
			...zip,
			keepLocal: Boolean(remote),
			storageNote: note
		});
	}

	/** A grid still for the file `id` names. */
	saveThumb(bytes: Buffer, id: string, now?: Date) {
		return this.local.saveThumb(bytes, id, now);
	}

	/**
	 * Uploads a file that is on disk to Zipline (the migration, or "Copy Mementos link" on an
	 * older item) and checks Zipline's copy byte for byte. Only then is the local copy removed.
	 * `existing` reuses a Zipline file uploaded before (a crash in between, or a link made by
	 * the old "Copy Mementos link" button).
	 */
	migrate(file: MigrateFile): Promise<MigrateResult> {
		// The migration and a "Copy Mementos link" tap can reach the same file at once.
		const running = this.migrating.get(file.path);
		if (running) return running;
		const work = this.migrateOnce(file).finally(() => this.migrating.delete(file.path));
		this.migrating.set(file.path, work);
		return work;
	}

	private async migrateOnce(file: MigrateFile): Promise<MigrateResult> {
		const zipline = this.zipline;
		if (!zipline) throw new Error('Mementos is not set up.');
		const full = await this.local.locate(file.path);
		if (!full) return { status: 'missing' };
		const size = (await stat(full)).size;
		const hash = await sha256File(full);

		let remote = file.existing?.id
			? await zipline.file(file.existing.id)
			: file.existing?.name
				? await zipline.file(file.existing.name)
				: null;
		let uploaded: { id: string; name: string; url: string };
		if (remote) {
			uploaded = remote;
		} else {
			const blob = await openAsBlob(full, { type: file.mime ?? 'application/octet-stream' });
			uploaded = await this.track(
				zipline.upload(blob, {
					name: file.name,
					mime: file.mime ?? 'application/octet-stream',
					folderId: await this.folder()
				})
			);
			remote = await zipline.file(uploaded.id);
		}
		const link = {
			ziplineId: uploaded.id,
			ziplineName: remote?.name ?? uploaded.name,
			mirrorUrl: remote?.url ?? uploaded.url
		};
		file.onUploaded?.(link);
		if (!remote)
			return { status: 'unverified', ...link, note: "Mementos didn't confirm the upload." };
		if (remote.size !== size)
			return {
				status: 'changed',
				...link,
				note: `Mementos keeps a changed copy (${remote.size} bytes, not ${size}); the original stays on the Archive's disk.`
			};
		const response = await zipline.raw({ id: uploaded.id, name: link.ziplineName });
		if (!response.ok) {
			await response.body?.cancel();
			throw new ZiplineError(
				`Mementos couldn't send the file back to check it (${response.status}).`,
				response.status
			);
		}
		const copy = await sha256Response(response);
		if (copy.hash !== hash || copy.bytes !== size)
			return {
				status: 'changed',
				...link,
				note: "Mementos' copy isn't byte for byte the same; the original stays on the Archive's disk."
			};
		await this.local.remove([file.path]);
		return { status: 'moved', ...link };
	}

	/** Removes files: thumbnails and local originals always, Zipline's copies when asked. */
	async remove(
		files: { paths: readonly string[]; zipline: readonly string[] },
		alsoZipline: boolean
	): Promise<{ ziplineFailed: number }> {
		await this.local.remove(files.paths);
		let ziplineFailed = 0;
		if (alsoZipline && this.zipline) {
			for (const id of files.zipline) {
				try {
					await this.zipline.remove(id);
				} catch (error) {
					ziplineFailed++;
					this.log(`couldn't delete ${id} on Mementos: ${String(error)}`);
				}
			}
		}
		return { ziplineFailed };
	}
}

export interface MigrateFile {
	path: string;
	mime: string | null;
	name: string;
	existing?: { id: string | null; name: string | null } | null;
	/** Called as soon as Zipline has a copy, before it is checked, so it is never uploaded twice. */
	onUploaded?: (link: { ziplineId: string; ziplineName: string; mirrorUrl: string }) => void;
}

export type MigrateResult =
	| { status: 'missing' }
	| {
			status: 'moved' | 'changed' | 'unverified';
			ziplineId: string;
			ziplineName: string;
			mirrorUrl: string;
			note?: string;
	  };

function saved(
	file: PreparedFile,
	where: Partial<
		Pick<SavedFile, 'ziplineId' | 'ziplineName' | 'mirrorUrl' | 'keepLocal' | 'storageNote'>
	> & {
		path: string | null;
	}
): SavedFile {
	return {
		id: file.id,
		kind: file.kind,
		mime: file.mime,
		bytes: file.bytes,
		width: file.width,
		height: file.height,
		thumbPath: file.thumbPath,
		path: where.path,
		ziplineId: where.ziplineId ?? null,
		ziplineName: where.ziplineName ?? null,
		mirrorUrl: where.mirrorUrl ?? null,
		keepLocal: where.keepLocal ?? false,
		storageNote: where.storageNote ?? null
	};
}
