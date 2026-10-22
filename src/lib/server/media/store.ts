import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { newId } from '../ids.ts';
import { sniff, type Sniffed } from './magic.ts';

/** A file the Archive refuses, with a reason she can read. */
export class MediaRejected extends Error {
	override readonly name = 'MediaRejected';
}

/** A checked file with its thumbnail written, before the original is put anywhere. */
export interface PreparedFile {
	readonly id: string;
	/** Where it goes on disk if kept locally, relative to the media folder: 2026/10/<id>.jpg */
	readonly path: string;
	/** A file name for elsewhere (Zipline): <id>.jpg */
	readonly name: string;
	readonly thumbPath: string | null;
	readonly mime: string;
	readonly kind: Sniffed['kind'];
	readonly width: number | null;
	readonly height: number | null;
	readonly bytes: number;
}

export type StoredFile = PreparedFile;

/** Relative paths the media route will serve: yyyy/mm/<id>.<ext> or <id>.thumb.webp. */
export const MEDIA_PATH =
	/^\d{4}\/\d{2}\/[a-z0-9]{8,32}(\.thumb\.webp|\.(jpg|png|gif|webp|avif|mp4|mov|webm))$/;

export function datedFolder(now: Date): string {
	return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

const isThumb = (path: string) => path.endsWith('.thumb.webp');

/**
 * Files on disk: originals under data/media/<yyyy>/<mm>/ (checked by their bytes) and small
 * still WebPs for the grid under data/thumbs/<yyyy>/<mm>/. Animated GIFs get a still of their
 * first frame and play when opened. With Zipline set up, only the thumbnails stay here.
 */
export class MediaStore {
	readonly root: string;
	readonly thumbRoot: string;
	readonly thumbWidth: number;

	constructor(root: string, thumbWidth = 480, thumbRoot: string = root) {
		this.root = resolve(root);
		this.thumbRoot = resolve(thumbRoot);
		this.thumbWidth = thumbWidth;
	}

	/**
	 * The absolute path of a stored file, or null for anything outside the media folder.
	 * Thumbnails are looked for in data/thumbs; `legacy` gives where older ones lived.
	 */
	absolute(path: string, legacy = false): string | null {
		if (!MEDIA_PATH.test(path)) return null;
		const root = isThumb(path) && !legacy ? this.thumbRoot : this.root;
		const full = resolve(root, path);
		return full.startsWith(root + sep) ? full : null;
	}

	/** Where a stored file is on disk right now, or null. */
	async locate(path: string): Promise<string | null> {
		for (const legacy of isThumb(path) ? [false, true] : [false]) {
			const full = this.absolute(path, legacy);
			if (full && (await stat(full).catch(() => null))?.isFile()) return full;
		}
		return null;
	}

	/** Checks and stores a file. Throws MediaRejected when it isn't something the Archive keeps. */
	async save(
		bytes: Buffer,
		options: { maxBytes: number; now?: Date; id?: string }
	): Promise<StoredFile> {
		const file = await this.prepare(bytes, options);
		await this.writeOriginal(file.path, bytes);
		return file;
	}

	/** Writes an original to disk (when Zipline isn't there to take it). */
	async writeOriginal(path: string, bytes: Buffer): Promise<void> {
		await this.write(path, bytes);
	}

	/**
	 * Checks a file and writes its thumbnail, but not the file itself. Throws MediaRejected when
	 * it isn't something the Archive keeps.
	 */
	async prepare(
		bytes: Buffer,
		options: { maxBytes: number; now?: Date; id?: string }
	): Promise<PreparedFile> {
		if (bytes.length === 0) throw new MediaRejected('The file is empty.');
		if (bytes.length > options.maxBytes)
			throw new MediaRejected(
				`The file is over the ${Math.round(options.maxBytes / 1e6)} MB limit.`
			);
		const type = sniff(bytes);
		if (!type)
			throw new MediaRejected(
				'Only pictures (JPEG, PNG, WebP, AVIF), GIFs and MP4/WebM/MOV videos can be saved.'
			);
		const id = options.id ?? newId();
		const folder = datedFolder(options.now ?? new Date());
		const path = `${folder}/${id}.${type.ext}`;

		let width: number | null = null;
		let height: number | null = null;
		let thumbPath: string | null = null;
		if (type.kind !== 'video') {
			const thumb = await this.makeThumb(bytes);
			width = thumb.width;
			height = thumb.height;
			thumbPath = `${folder}/${id}.thumb.webp`;
			await this.write(thumbPath, thumb.data);
		}
		return {
			id,
			path,
			name: `${id}.${type.ext}`,
			thumbPath,
			mime: type.mime,
			kind: type.kind,
			width,
			height,
			bytes: bytes.length
		};
	}

	/** A grid still from a picture (a video's poster frame), stored next to the file `id` names. */
	async saveThumb(
		bytes: Buffer,
		id: string,
		now = new Date()
	): Promise<{ thumbPath: string; width: number | null; height: number | null }> {
		const type = sniff(bytes);
		if (!type || type.kind === 'video')
			throw new MediaRejected('The still frame is not a picture.');
		const thumb = await this.makeThumb(bytes);
		const thumbPath = `${datedFolder(now)}/${id}.thumb.webp`;
		await this.write(thumbPath, thumb.data);
		return { thumbPath, width: thumb.width, height: thumb.height };
	}

	private async makeThumb(
		bytes: Buffer
	): Promise<{ data: Buffer; width: number | null; height: number | null }> {
		try {
			// Only the first frame of an animation; turned upright from the camera's orientation.
			const image = sharp(bytes, { animated: false, failOn: 'error' });
			const meta = await image.metadata();
			const upright = meta.autoOrient ?? {
				width: meta.width,
				height: meta.pageHeight ?? meta.height
			};
			const data = await image
				.rotate()
				.resize({ width: this.thumbWidth, withoutEnlargement: true })
				.webp({ quality: 74 })
				.toBuffer();
			return { data, width: upright.width ?? null, height: upright.height ?? null };
		} catch {
			throw new MediaRejected('This picture could not be read; it may be damaged.');
		}
	}

	private async write(path: string, data: Buffer): Promise<void> {
		const full = join(isThumb(path) ? this.thumbRoot : this.root, path);
		await mkdir(dirname(full), { recursive: true });
		const temporary = `${full}.${process.pid}.tmp`;
		await writeFile(temporary, data);
		await rename(temporary, full);
	}

	/** Removes stored files; ones already gone are fine. */
	async remove(paths: readonly string[]): Promise<void> {
		for (const path of paths) {
			for (const legacy of isThumb(path) ? [false, true] : [false]) {
				const full = this.absolute(path, legacy);
				if (full) await rm(full, { force: true });
			}
		}
	}

	/**
	 * Moves thumbnails made before they had their own folder from data/media to data/thumbs.
	 * Safe to run every start: there is nothing to do the second time.
	 */
	async moveThumbs(): Promise<number> {
		if (this.thumbRoot === this.root) return 0;
		let moved = 0;
		const years = await readdir(this.root).catch(() => [] as string[]);
		for (const year of years.filter((name) => /^\d{4}$/.test(name))) {
			const months = await readdir(join(this.root, year)).catch(() => [] as string[]);
			for (const month of months.filter((name) => /^\d{2}$/.test(name))) {
				const names = await readdir(join(this.root, year, month)).catch(() => [] as string[]);
				for (const name of names) {
					const path = `${year}/${month}/${name}`;
					if (!isThumb(name) || !MEDIA_PATH.test(path)) continue;
					await mkdir(join(this.thumbRoot, year, month), { recursive: true });
					await rename(join(this.root, path), join(this.thumbRoot, path));
					moved++;
				}
			}
		}
		return moved;
	}

	/** Whether the media folder can be written (for /healthz). */
	async writable(): Promise<boolean> {
		try {
			await mkdir(this.root, { recursive: true });
			const probe = join(this.root, `.probe-${process.pid}`);
			await writeFile(probe, '');
			await rm(probe, { force: true });
			return (await stat(this.root)).isDirectory();
		} catch {
			return false;
		}
	}
}
