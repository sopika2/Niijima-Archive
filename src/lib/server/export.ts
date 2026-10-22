import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { finished } from 'node:stream/promises';
import yazl from 'yazl';
import type { Db } from './db/client.ts';
import { listItems, mediaOf, type ItemFilter } from './db/items.ts';
import type { MediaRow } from './db/schema.ts';
import { EXT_BY_MIME } from './media/magic.ts';
import type { Storage } from './media/storage.ts';

/** A file name for the download: "Roman / Talia / Omi" becomes "roman-talia-omi". */
export function slug(name: string): string {
	return (
		name
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'archive'
	);
}

/** Where one file of the zip comes from. */
type Source = { kind: 'disk'; path: string } | { kind: 'zipline'; row: MediaRow };

/**
 * Everything in a filter as a .zip: each file under files/ (stored, not recompressed) and a
 * captions.json describing every item, so the captions travel with the pictures. Files stream
 * from disk or from Zipline one after another, so a big collection never sits in memory.
 */
export function exportZip(
	db: Db,
	storage: Storage,
	filter: ItemFilter,
	title: string,
	log: (message: string) => void = () => {}
): ReadableStream<Uint8Array> {
	const zip = new yazl.ZipFile();
	const entries: unknown[] = [];
	const files: Array<{ name: string; source: Source }> = [];
	let cursor: string | null = null;
	let n = 0;
	do {
		const page = listItems(db, filter, { cursor, limit: 200 });
		for (const item of page.items) {
			n++;
			const names: string[] = [];
			const rows = mediaOf(db, item.id);
			rows.forEach((row, index) => {
				const source: Source | null = row.path
					? { kind: 'disk', path: row.path }
					: row.ziplineId && !row.ziplineGoneAt && storage.zipline
						? { kind: 'zipline', row }
						: null;
				if (!source) return;
				const ext =
					row.path?.split('.').pop() ??
					EXT_BY_MIME[row.mime ?? ''] ??
					row.ziplineName?.split('.').pop() ??
					'bin';
				const name = `files/${String(n).padStart(4, '0')}-${item.id}${rows.length > 1 ? `-${index + 1}` : ''}.${ext}`;
				files.push({ name, source });
				names.push(name);
			});
			entries.push({
				id: item.id,
				kind: item.kind,
				owner: item.owner,
				collection: item.collection?.name ?? null,
				caption: item.caption,
				tags: item.tags,
				source_url: item.sourceUrl,
				saved_at: item.createdAt,
				tweet: item.tweet
					? {
							url: item.tweet.url,
							text: item.tweet.text,
							author_name: item.tweet.authorName,
							author_handle: item.tweet.authorHandle,
							posted_at: item.tweet.postedAt,
							quote: item.tweet.quote
						}
					: null,
				files: names,
				mementos: item.media.map((file) => file.mirrorUrl).filter(Boolean)
			});
		}
		cursor = page.next;
	} while (cursor);
	const manifest = {
		title,
		exported_at: new Date().toISOString(),
		count: entries.length,
		items: entries
	};

	// The zip is read while it is written: each file is added once the one before has gone out.
	void (async () => {
		const missing: string[] = [];
		for (const file of files) {
			try {
				const stream = await open(storage, file.source);
				if (!stream) {
					missing.push(file.name);
					continue;
				}
				zip.addReadStream(stream, file.name, { compress: false });
				await finished(stream);
			} catch (error) {
				missing.push(file.name);
				log(`export: ${file.name} left out: ${error instanceof Error ? error.message : error}`);
			}
		}
		const notes = missing.length > 0 ? { missing_files: missing } : {};
		zip.addBuffer(
			Buffer.from(JSON.stringify({ ...manifest, ...notes }, null, 2) + '\n'),
			'captions.json'
		);
		zip.end();
	})();
	return Readable.toWeb(zip.outputStream as Readable) as ReadableStream<Uint8Array>;
}

async function open(storage: Storage, source: Source): Promise<Readable | null> {
	if (source.kind === 'disk') {
		const path = await storage.local.locate(source.path);
		if (!path) return null;
		return createReadStream(path);
	}
	const { row } = source;
	const response = await storage.zipline!.raw({ id: row.ziplineId!, name: row.ziplineName });
	if (response.status !== 200 || !response.body) {
		await response.body?.cancel();
		throw new Error(`Mementos answered ${response.status}`);
	}
	return Readable.fromWeb(response.body as NodeReadableStream);
}
