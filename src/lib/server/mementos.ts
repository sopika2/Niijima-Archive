import { and, asc, eq, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { getSetting, setSetting, type Db } from './db/client.ts';
import { createCollection, findCollectionByName, getCollection } from './db/collections.ts';
import { addMedia, createItem, ignoreZipline, updateMedia } from './db/items.ts';
import { media, ziplineIgnored, type MediaKind } from './db/schema.ts';
import { newId } from './ids.ts';
import type { Storage } from './media/storage.ts';
import { MediaRejected } from './media/store.ts';
import { nameFromLink, ZiplineError, type Zipline, type ZiplineFile } from './zipline.ts';

/*
 * The background side of Mementos (Zipline as the Archive's storage), one step after another
 * so they never trip over each other:
 *
 *  1. migration: every original still on the Archive's disk is uploaded, checked byte for byte
 *     and only then removed here. It picks up where it stopped after a restart.
 *  2. sync: her Zipline files are listed; ones she uploaded straight to Zipline (phone, ShareX,
 *     the web page) become items in the Inbox collection, and items whose file was deleted on
 *     Zipline are marked.
 *
 * Runs on start, then every few minutes, and when she taps "Sync now".
 */

export interface MementosOptions {
	readonly db: Db;
	readonly storage: Storage;
	readonly zipline: Zipline;
	readonly syncMinutes: number;
	/** The collection her own Zipline uploads land in. */
	readonly inbox: string;
	/** Largest picture downloaded to make a thumbnail of. */
	readonly maxImportBytes: number;
	readonly log?: (message: string) => void;
	/** For tests: how long a busy Zipline (429) is waited for, in ms. */
	readonly sleep?: (ms: number) => Promise<void>;
}

export interface SyncResult {
	readonly at: string;
	readonly files: number;
	readonly imported: number;
	readonly gone: number;
	readonly back: number;
	readonly failed: number;
}

export interface MementosStatus {
	readonly url: string;
	readonly connection: {
		state: 'checking' | 'ok' | 'error';
		error: string | null;
		at: string | null;
	};
	readonly busy: 'migrating' | 'syncing' | null;
	readonly migration: {
		readonly pending: number;
		readonly moved: number;
		readonly kept: number;
		readonly failed: number;
		readonly current: string | null;
		readonly lastError: string | null;
	};
	readonly sync: {
		readonly every: number;
		readonly last: SyncResult | null;
		readonly lastError: string | null;
		readonly progress: string | null;
	};
	readonly onZipline: number;
	readonly gone: number;
}

const ACCEPTED: Record<string, MediaKind> = {
	'image/jpeg': 'image',
	'image/png': 'image',
	'image/webp': 'image',
	'image/avif': 'image',
	'image/gif': 'gif',
	'video/mp4': 'video',
	'video/webm': 'video',
	'video/quicktime': 'video'
};

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Mementos {
	private readonly options: MementosOptions;
	private readonly log: (message: string) => void;
	private readonly sleep: (ms: number) => Promise<void>;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running: Promise<void> | null = null;
	private again = false;
	/** Files that failed for a reason a retry won't fix by itself; tried again on "Retry". */
	private readonly skipped = new Set<string>();

	private connection: MementosStatus['connection'] = { state: 'checking', error: null, at: null };
	private busy: MementosStatus['busy'] = null;
	private current: string | null = null;
	private migrationError: string | null = null;
	private lastSync: SyncResult | null = null;
	private syncError: string | null = null;
	private progress: string | null = null;

	constructor(options: MementosOptions) {
		this.options = options;
		this.log = options.log ?? (() => {});
		this.sleep = options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
		this.lastSync = getSetting<SyncResult>(options.db, 'zipline_last_sync') ?? null;
	}

	/** Starts the loop: a first run now, then every `syncMinutes`. */
	start(): void {
		void this.run();
		this.timer = setInterval(() => void this.run(), this.options.syncMinutes * 60_000);
		this.timer.unref?.();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/** One full round (check, migrate, sync). A call while one runs queues one more after it. */
	run(): Promise<void> {
		if (this.running) {
			this.again = true;
			return this.running;
		}
		this.running = (async () => {
			do {
				this.again = false;
				await this.round();
			} while (this.again);
		})().finally(() => {
			this.running = null;
		});
		return this.running;
	}

	/** "Retry": files that failed get another go, then a round runs. */
	retry(): Promise<void> {
		this.skipped.clear();
		return this.run();
	}

	private async round(): Promise<void> {
		try {
			await this.options.zipline.check();
			this.connection = { state: 'ok', error: null, at: new Date().toISOString() };
		} catch (error) {
			this.connection = { state: 'error', error: describe(error), at: new Date().toISOString() };
			this.log(`can't reach Mementos: ${describe(error)}`);
			return;
		}
		this.busy = 'migrating';
		try {
			await this.migrate();
		} finally {
			this.busy = null;
			this.current = null;
		}
		this.busy = 'syncing';
		try {
			this.lastSync = await this.sync();
			setSetting(this.options.db, 'zipline_last_sync', this.lastSync);
			this.syncError = null;
		} catch (error) {
			this.syncError = describe(error);
			this.log(`sync stopped: ${this.syncError}`);
		} finally {
			this.busy = null;
			this.progress = null;
		}
	}

	/** Uploads every original still on disk, oldest first. Stops early when Zipline is down. */
	async migrate(): Promise<{ moved: number; kept: number; failed: number }> {
		const { db, storage } = this.options;
		const tally = { moved: 0, kept: 0, failed: 0 };
		for (;;) {
			const row = db
				.select()
				.from(media)
				.where(
					and(
						isNotNull(media.path),
						eq(media.keepLocal, false),
						this.skipped.size > 0 ? notInArray(media.id, [...this.skipped]) : undefined
					)
				)
				.orderBy(asc(media.createdAt), asc(media.id))
				.limit(1)
				.get();
			if (!row) break;
			this.current = row.path;
			try {
				const result = await storage.migrate({
					path: row.path!,
					mime: row.mime,
					name: row.path!.split('/').pop()!,
					existing:
						row.ziplineId || row.mirrorUrl
							? { id: row.ziplineId, name: row.ziplineName ?? nameFromLink(row.mirrorUrl) }
							: null,
					onUploaded: (link) => updateMedia(db, row.id, link)
				});
				if (result.status === 'missing') {
					// Nothing on disk to upload. If Zipline already has it, that copy is the file.
					updateMedia(db, row.id, {
						path: null,
						...(row.ziplineId
							? {}
							: { storageNote: "The file was missing from the Archive's disk." })
					});
					if (!row.ziplineId) this.skipped.add(row.id);
					continue;
				}
				const link = {
					ziplineId: result.ziplineId,
					ziplineName: result.ziplineName,
					mirrorUrl: result.mirrorUrl
				};
				if (result.status === 'moved') {
					updateMedia(db, row.id, { ...link, path: null, storageNote: null, ziplineGoneAt: null });
					tally.moved++;
				} else if (result.status === 'changed') {
					updateMedia(db, row.id, { ...link, keepLocal: true, storageNote: result.note ?? null });
					tally.kept++;
					this.log(`kept ${row.path} on disk: ${result.note}`);
				} else {
					updateMedia(db, row.id, { ...link, storageNote: result.note ?? null });
					this.skipped.add(row.id);
					tally.failed++;
				}
				this.migrationError = null;
			} catch (error) {
				const reason = describe(error);
				updateMedia(db, row.id, { storageNote: reason });
				this.migrationError = `${row.path}: ${reason}`;
				if (error instanceof ZiplineError && error.status === 429) {
					await this.sleep(Math.min(error.retryAfter ?? 60, 300) * 1000);
					continue;
				}
				tally.failed++;
				this.log(`couldn't move ${row.path} to Mementos: ${reason}`);
				// Zipline is down or struggling: the next round carries on from here.
				if (error instanceof ZiplineError && error.transient) break;
				this.skipped.add(row.id);
			}
		}
		if (tally.moved + tally.kept + tally.failed > 0)
			this.log(
				`migration: ${tally.moved} moved to Mementos, ${tally.kept} kept on disk, ${tally.failed} to retry`
			);
		return tally;
	}

	/** Brings in her own Zipline uploads and marks files deleted there. */
	async sync(): Promise<SyncResult> {
		const { db, storage, zipline } = this.options;
		this.progress = 'Listing files on Mementos…';
		const files = await zipline.all();
		// An upload that was under way while the list was made is recorded once it settles.
		await storage.settled();

		const rows = db
			.select({
				id: media.id,
				ziplineId: media.ziplineId,
				ziplineName: media.ziplineName,
				mirrorUrl: media.mirrorUrl,
				gone: media.ziplineGoneAt
			})
			.from(media)
			.where(sql`${media.ziplineId} IS NOT NULL OR ${media.mirrorUrl} IS NOT NULL`)
			.all();
		const byId = new Map(rows.filter((row) => row.ziplineId).map((row) => [row.ziplineId!, row]));
		const names = new Set(
			rows
				.filter((row) => !row.ziplineId)
				.map((row) => nameFromLink(row.mirrorUrl))
				.filter((name): name is string => Boolean(name))
		);
		const ignored = new Set(
			db
				.select({ id: ziplineIgnored.ziplineId })
				.from(ziplineIgnored)
				.all()
				.map((row) => row.id)
		);

		const listed = new Set(files.map((file) => file.id));
		let gone = 0;
		let back = 0;
		const now = new Date().toISOString();
		for (const row of byId.values()) {
			if (!listed.has(row.ziplineId!) && !row.gone) {
				updateMedia(db, row.id, { ziplineGoneAt: now });
				gone++;
			} else if (listed.has(row.ziplineId!) && row.gone) {
				updateMedia(db, row.id, { ziplineGoneAt: null });
				back++;
			}
		}

		const fresh = files.filter(
			(file) =>
				!byId.has(file.id) && !names.has(file.name) && !ignored.has(file.id) && ACCEPTED[file.type]
		);
		let imported = 0;
		let failed = 0;
		for (const [index, file] of fresh.entries()) {
			this.progress = `Bringing in ${index + 1} of ${fresh.length} from Mementos…`;
			try {
				if (await this.importFile(file)) imported++;
			} catch (error) {
				failed++;
				this.log(`couldn't bring in ${file.name}: ${describe(error)}`);
				if (error instanceof ZiplineError && error.transient) break;
			}
		}
		if (imported + gone + back > 0)
			this.log(`sync: ${imported} new from Mementos, ${gone} deleted there, ${back} back`);
		return { at: new Date().toISOString(), files: files.length, imported, gone, back, failed };
	}

	/** Makes an Inbox item for one of her own Zipline files. False when it isn't one to keep. */
	private async importFile(file: ZiplineFile): Promise<boolean> {
		const { db, storage, zipline } = this.options;
		const id = newId();
		let kind = ACCEPTED[file.type]!;
		let mime = file.type;
		let thumb: { thumbPath: string | null; width: number | null; height: number | null } = {
			thumbPath: null,
			width: null,
			height: null
		};
		if (kind !== 'video' && file.size <= this.options.maxImportBytes) {
			const bytes = await this.download(zipline, { id: file.id, name: file.name });
			try {
				const prepared = await storage.local.prepare(bytes, {
					id,
					maxBytes: this.options.maxImportBytes
				});
				kind = prepared.kind;
				mime = prepared.mime;
				thumb = prepared;
			} catch (error) {
				if (!(error instanceof MediaRejected)) throw error;
				ignoreZipline(db, [file.id], `not kept: ${error.message}`);
				return false;
			}
		} else if (kind === 'video' && file.thumbnail) {
			try {
				const still = await this.download(zipline, { id: file.thumbnail, name: file.thumbnail });
				thumb = await storage.saveThumb(still, id);
			} catch (error) {
				if (error instanceof ZiplineError && error.transient) throw error;
				// No still frame: the grid plays the first moment of the video instead.
			}
		}
		const itemId = createItem(db, {
			kind: 'image',
			owner: 'shared',
			collectionId: this.inboxCollection(),
			createdAt: file.createdAt
		});
		addMedia(db, {
			id,
			itemId,
			position: 0,
			kind,
			mime,
			path: null,
			thumbPath: thumb.thumbPath,
			width: thumb.width,
			height: thumb.height,
			bytes: file.size,
			ziplineId: file.id,
			ziplineName: file.name,
			mirrorUrl: file.url
		});
		return true;
	}

	private async download(zipline: Zipline, file: { id: string; name: string }): Promise<Buffer> {
		const response = await zipline.raw(file);
		if (!response.ok) {
			await response.body?.cancel();
			throw new ZiplineError(
				`Mementos answered ${response.status} for ${file.name}.`,
				response.status
			);
		}
		return Buffer.from(await response.arrayBuffer());
	}

	/** The shared Inbox collection, made the first time (and again if she deleted it). */
	inboxCollection(): string {
		const { db } = this.options;
		const known = getSetting<string>(db, 'zipline_inbox_collection');
		if (known && getCollection(db, known)) return known;
		const id =
			findCollectionByName(db, this.options.inbox)?.id ??
			createCollection(db, { name: this.options.inbox, owner: 'shared' });
		setSetting(db, 'zipline_inbox_collection', id);
		return id;
	}

	status(): MementosStatus {
		const { db } = this.options;
		const count = (where: ReturnType<typeof and>) =>
			db
				.select({ n: sql<number>`count(*)` })
				.from(media)
				.where(where)
				.get()?.n ?? 0;
		return {
			url: this.options.zipline.url,
			connection: this.connection,
			busy: this.busy,
			migration: {
				pending: count(and(isNotNull(media.path), eq(media.keepLocal, false))),
				moved: count(and(isNotNull(media.ziplineId), isNull(media.path))),
				kept: count(eq(media.keepLocal, true)),
				failed: count(
					and(isNotNull(media.path), eq(media.keepLocal, false), isNotNull(media.storageNote))
				),
				current: this.current,
				lastError: this.migrationError
			},
			sync: {
				every: this.options.syncMinutes,
				last: this.lastSync,
				lastError: this.syncError,
				progress: this.progress
			},
			onZipline: count(isNotNull(media.ziplineId)),
			gone: count(isNotNull(media.ziplineGoneAt))
		};
	}
}
