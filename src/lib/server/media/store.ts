import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { newId } from '../ids.ts';
import { sniff, type Sniffed } from './magic.ts';

/** A file the Archive refuses, with a reason she can read. */
export class MediaRejected extends Error {
	override readonly name = 'MediaRejected';
}

export interface StoredFile {
	readonly id: string;
	/** Relative to the media folder: 2026/10/<id>.jpg */
	readonly path: string;
	readonly thumbPath: string | null;
	readonly mime: string;
	readonly kind: Sniffed['kind'];
	readonly width: number | null;
	readonly height: number | null;
	readonly bytes: number;
}

/** Relative paths the media route will serve: yyyy/mm/<id>.<ext> or <id>.thumb.webp. */
export const MEDIA_PATH =
	/^\d{4}\/\d{2}\/[a-z0-9]{8,32}(\.thumb\.webp|\.(jpg|png|gif|webp|avif|mp4|mov|webm))$/;

export function datedFolder(now: Date): string {
	return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Files on disk under data/media/<yyyy>/<mm>/: the original as it came (checked by its bytes),
 * and a small still WebP for the grid. Animated GIFs get a still of their first frame and play
 * when opened.
 */
export class MediaStore {
	readonly root: string;
	readonly thumbWidth: number;

	constructor(root: string, thumbWidth = 480) {
		this.root = resolve(root);
		this.thumbWidth = thumbWidth;
	}

	/** The absolute path of a stored file, or null for anything outside the media folder. */
	absolute(path: string): string | null {
		if (!MEDIA_PATH.test(path)) return null;
		const full = resolve(this.root, path);
		return full.startsWith(this.root + sep) ? full : null;
	}

	/** Checks and stores a file. Throws MediaRejected when it isn't something the Archive keeps. */
	async save(
		bytes: Buffer,
		options: { maxBytes: number; now?: Date; id?: string }
	): Promise<StoredFile> {
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
		await this.write(path, bytes);
		return {
			id,
			path,
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
		const full = join(this.root, path);
		await mkdir(dirname(full), { recursive: true });
		const temporary = `${full}.${process.pid}.tmp`;
		await writeFile(temporary, data);
		await rename(temporary, full);
	}

	/** Removes stored files; ones already gone are fine. */
	async remove(paths: readonly string[]): Promise<void> {
		for (const path of paths) {
			const full = this.absolute(path);
			if (full) await rm(full, { force: true });
		}
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
