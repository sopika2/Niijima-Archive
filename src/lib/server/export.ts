import { Readable } from 'node:stream';
import yazl from 'yazl';
import type { Db } from './db/client.ts';
import { listItems, type ItemFilter } from './db/items.ts';
import type { MediaStore } from './media/store.ts';

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

/**
 * Everything in a filter as a .zip: each file under files/ (stored, not recompressed) and a
 * captions.json describing every item, so the captions travel with the pictures. Streams from
 * disk, so a big collection doesn't sit in memory.
 */
export function exportZip(
	db: Db,
	store: MediaStore,
	filter: ItemFilter,
	title: string
): ReadableStream<Uint8Array> {
	const zip = new yazl.ZipFile();
	const entries: unknown[] = [];
	let cursor: string | null = null;
	let n = 0;
	do {
		const page = listItems(db, filter, { cursor, limit: 200 });
		for (const item of page.items) {
			n++;
			const files: string[] = [];
			item.media.forEach((file, index) => {
				const relative = file.url?.replace(/^\/media\//, '');
				const absolute = relative ? store.absolute(relative) : null;
				if (!relative || !absolute) return;
				const ext = relative.split('.').pop();
				const name = `files/${String(n).padStart(4, '0')}-${item.id}${item.media.length > 1 ? `-${index + 1}` : ''}.${ext}`;
				zip.addFile(absolute, name, { compress: false });
				files.push(name);
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
				files,
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
	zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 'captions.json');
	zip.end();
	return Readable.toWeb(zip.outputStream as Readable) as ReadableStream<Uint8Array>;
}
