import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { newId } from './ids.ts';
import { sniff, type Sniffed } from './media/magic.ts';

export interface StagedFile extends Sniffed {
	readonly name: string;
	readonly bytes: number;
}

export interface Staged {
	readonly token: string;
	readonly title: string;
	readonly text: string;
	readonly url: string;
	readonly createdAt: string;
	readonly files: readonly StagedFile[];
	/** Files that were left out, with the reason. */
	readonly rejected: readonly string[];
}

const TOKEN = /^[a-z0-9]{24}$/;

/**
 * Where Android's share sheet drops things (data/inbox/<token>/). Nothing is saved to the Den
 * until she adds her caption and taps Steal; leftovers older than a day are swept away.
 */
export class Inbox {
	readonly root: string;
	constructor(root: string) {
		this.root = resolve(root);
	}

	private dir(token: string): string | null {
		return TOKEN.test(token) ? join(this.root, token) : null;
	}

	async stage(
		shared: { title: string; text: string; url: string; files: readonly File[] },
		maxBytes: number
	): Promise<Staged> {
		const token = newId(24);
		const dir = join(this.root, token);
		await mkdir(dir, { recursive: true });
		const files: StagedFile[] = [];
		const rejected: string[] = [];
		for (const file of shared.files.slice(0, 30)) {
			const label = file.name || 'file';
			if (file.size > maxBytes) {
				rejected.push(`${label}: over the ${Math.round(maxBytes / 1e6)} MB limit`);
				continue;
			}
			const bytes = Buffer.from(await file.arrayBuffer());
			const type = sniff(bytes);
			if (!type) {
				rejected.push(`${label}: not a picture, GIF or video`);
				continue;
			}
			await writeFile(join(dir, `${files.length}.${type.ext}`), bytes);
			files.push({ ...type, name: label.slice(0, 120), bytes: bytes.length });
		}
		const staged: Staged = {
			token,
			title: shared.title.slice(0, 500),
			text: shared.text.slice(0, 5000),
			url: shared.url.slice(0, 2000),
			createdAt: new Date().toISOString(),
			files,
			rejected
		};
		await writeFile(join(dir, 'meta.json'), JSON.stringify(staged));
		return staged;
	}

	async read(token: string): Promise<Staged | null> {
		const dir = this.dir(token);
		if (!dir) return null;
		try {
			return JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Staged;
		} catch {
			return null;
		}
	}

	/** The absolute path of a staged file, or null. */
	async file(token: string, index: number): Promise<{ path: string; mime: string } | null> {
		const staged = await this.read(token);
		const file = staged?.files[index];
		const dir = this.dir(token);
		return file && dir ? { path: join(dir, `${index}.${file.ext}`), mime: file.mime } : null;
	}

	async bytes(token: string, index: number): Promise<Buffer | null> {
		const found = await this.file(token, index);
		return found ? readFile(found.path) : null;
	}

	async discard(token: string): Promise<void> {
		const dir = this.dir(token);
		if (dir) await rm(dir, { recursive: true, force: true });
	}

	/** Removes staged shares older than `maxAgeMs`. */
	async sweep(maxAgeMs = 86_400_000): Promise<number> {
		let removed = 0;
		const names = await readdir(this.root).catch(() => null);
		if (!names) return 0;
		for (const name of names) {
			if (!TOKEN.test(name)) continue;
			const info = await stat(join(this.root, name)).catch(() => null);
			if (info && Date.now() - info.mtimeMs > maxAgeMs) {
				await rm(join(this.root, name), { recursive: true, force: true });
				removed++;
			}
		}
		return removed;
	}
}
