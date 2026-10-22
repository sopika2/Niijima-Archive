import { env } from '$env/dynamic/private';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { accessOff, discordAccess, type AccessGate } from './access.ts';
import { ConfigError, defaultConfig, parseConfig, type Config } from './config.ts';
import { openDatabase, type Archive } from './db/client.ts';
import { seedCollections } from './db/collections.ts';
import { Inbox } from './inbox.ts';
import { log, logError } from './log.ts';
import { Storage } from './media/storage.ts';
import { MediaStore } from './media/store.ts';
import { Mementos } from './mementos.ts';
import type { SaveServices } from './save.ts';
import { Zipline } from './zipline.ts';

export interface Runtime {
	readonly version: string;
	readonly startedAt: Date;
	readonly config: Config;
	readonly paths: { readonly config: string; readonly data: string; readonly assets: string };
	readonly archive: Archive;
	readonly store: MediaStore;
	/** Where saved files go: Zipline when it is set up, the disk otherwise. */
	readonly storage: Storage;
	readonly inbox: Inbox;
	readonly access: AccessGate;
	/** The origins form posts may come from: this site as the browser sees it. */
	readonly origins: readonly string[];
	readonly publicUrl: string | null;
	readonly saveToken: string | null;
	readonly zipline: Zipline | null;
	/** The migration and sync with Zipline; null without it. */
	readonly mementos: Mementos | null;
	readonly services: SaveServices;
}

declare const __ARCHIVE_VERSION__: string;

const KEY = Symbol.for('niijima-archive.runtime');
type Holder = { [KEY]?: Promise<Runtime> };

/** The booted app, created on first use and shared by every request. */
export function runtime(): Promise<Runtime> {
	const holder = globalThis as Holder;
	holder[KEY] ??= boot().catch((error) => {
		delete holder[KEY];
		throw error;
	});
	return holder[KEY];
}

const optional = (value: string | undefined) =>
	value === undefined || value.trim() === '' ? null : value.trim();

function readConfig(path: string): Config {
	if (!existsSync(path)) {
		log(
			'config',
			`${path} not found; using defaults. Copy config.example.yml to config.yml to change them.`
		);
		return defaultConfig();
	}
	try {
		return parseConfig(readFileSync(path, 'utf8'));
	} catch (error) {
		if (error instanceof ConfigError) log('config', error.message);
		throw error;
	}
}

function accessGate(config: Config): AccessGate {
	const mode = optional(env.ACCESS_MODE) ?? 'off';
	if (mode !== 'discord' && mode !== 'off') throw new Error('ACCESS_MODE must be discord or off.');
	if (mode === 'off') return accessOff();
	const values = {
		DISCORD_CLIENT_ID: optional(env.DISCORD_CLIENT_ID),
		DISCORD_CLIENT_SECRET: optional(env.DISCORD_CLIENT_SECRET),
		SESSION_SECRET: optional(env.SESSION_SECRET),
		PUBLIC_URL: optional(env.PUBLIC_URL)
	};
	const missing = Object.entries(values)
		.filter(([, value]) => !value)
		.map(([name]) => name);
	if (missing.length > 0) {
		throw new Error(
			`Discord sign-in needs ${missing.join(', ')} in .env (see README), or ACCESS_MODE=off for local development only.`
		);
	}
	if (values.SESSION_SECRET!.length < 32)
		throw new Error('SESSION_SECRET must be at least 32 characters (openssl rand -hex 32).');
	if (config.access.discord_user_ids.length === 0)
		log(
			'boot',
			'No Discord accounts are allowed yet. Sign in once: the page shows your Discord id to add to config.yml.'
		);
	return discordAccess({
		app: {
			clientId: values.DISCORD_CLIENT_ID!,
			clientSecret: values.DISCORD_CLIENT_SECRET!,
			redirectUri: `${values.PUBLIC_URL!.replace(/\/+$/, '')}/auth/callback`
		},
		sessionSecret: values.SESSION_SECRET!,
		allowedIds: config.access.discord_user_ids,
		cookieDomain: optional(env.SESSION_DOMAIN)?.replace(/^\./, '') ?? null
	});
}

/** The Zipline address the Archive itself calls, when none is set: the container next door. */
const ZIPLINE_INTERNAL_DEFAULT = 'http://zipline:3000';

function webAddress(name: string, value: string): string {
	try {
		const parsed = new URL(value);
		if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return value;
	} catch {
		// reported below
	}
	throw new Error(`${name} must be a web address such as https://mementos.niijimasisters.com.`);
}

function ziplineFromEnv(): Zipline | null {
	const url = optional(env.ZIPLINE_URL);
	const token = optional(env.ZIPLINE_TOKEN);
	if (!url || !token) return null;
	return new Zipline({
		url: webAddress('ZIPLINE_URL', url),
		internalUrl: webAddress(
			'ZIPLINE_INTERNAL_URL',
			optional(env.ZIPLINE_INTERNAL_URL) ?? ZIPLINE_INTERNAL_DEFAULT
		),
		token
	});
}

async function boot(): Promise<Runtime> {
	const version = typeof __ARCHIVE_VERSION__ === 'string' ? __ARCHIVE_VERSION__ : 'dev';
	log('boot', `Niijima Archive ${version} starting`);
	const configPath = resolve(optional(env.ARCHIVE_CONFIG) ?? 'config.yml');
	const config = readConfig(configPath);
	const access = accessGate(config);

	const data = resolve(optional(env.ARCHIVE_DATA) ?? 'data');
	const assets = resolve(optional(env.ARCHIVE_ASSETS) ?? 'assets');
	const archive = openDatabase({
		path: join(data, 'archive.db'),
		migrationsFolder: resolve(optional(env.ARCHIVE_MIGRATIONS) ?? 'migrations')
	});
	const seeded = seedCollections(archive.db);
	if (seeded > 0) log('boot', `created ${seeded} starting collections`);

	const store = new MediaStore(join(data, 'media'), config.media.thumb_width, join(data, 'thumbs'));
	const moved = await store.moveThumbs();
	if (moved > 0) log('boot', `moved ${moved} thumbnail(s) to ${join(data, 'thumbs')}`);
	const inbox = new Inbox(join(data, 'inbox'));
	const sweep = () =>
		inbox.sweep().then(
			(n) => n > 0 && log('inbox', `cleared ${n} unsaved share(s)`),
			(error) => logError('inbox', error)
		);
	void sweep();
	const timer = setInterval(sweep, 3_600_000);
	timer.unref();

	let saveToken = optional(env.SAVE_TOKEN);
	if (saveToken && saveToken.length < 24) {
		log(
			'boot',
			'SAVE_TOKEN is shorter than 24 characters, so /api/save stays off. Use openssl rand -hex 32.'
		);
		saveToken = null;
	}
	const publicUrl = optional(env.PUBLIC_URL)?.replace(/\/+$/, '') ?? null;
	const origins = [publicUrl, optional(env.ORIGIN)]
		.filter((value): value is string => Boolean(value))
		.map((value) => new URL(value).origin);
	const zipline = ziplineFromEnv();
	const storage = new Storage({
		local: store,
		zipline,
		folder: config.zipline.folder || null,
		log: (message) => log('mementos', message)
	});
	const maxUploadBytes = config.media.max_upload_mb * 1e6;
	const mementos = zipline
		? new Mementos({
				db: archive.db,
				storage,
				zipline,
				syncMinutes: config.zipline.sync_minutes,
				inbox: config.zipline.inbox_collection,
				maxImportBytes: maxUploadBytes,
				log: (message) => log('mementos', message)
			})
		: null;
	mementos?.start();

	process.once('sveltekit:shutdown', () => {
		clearInterval(timer);
		mementos?.stop();
		archive.close();
		log('boot', 'stopped');
	});

	log(
		'boot',
		`ready · data ${data} · access ${access.mode}${access.cookieDomain ? ` (cookie on ${access.cookieDomain})` : ''} · /api/save ${saveToken ? 'on' : 'off'} · files on ${zipline ? `Mementos (${zipline.url} via ${zipline.internalUrl})` : 'disk'}`
	);
	if (access.mode === 'off')
		log('boot', 'No sign-in (ACCESS_MODE=off): anyone who can reach this app gets in.');

	return {
		version,
		startedAt: new Date(),
		config,
		paths: { config: configPath, data, assets },
		archive,
		store,
		storage,
		inbox,
		access,
		origins,
		publicUrl,
		saveToken,
		zipline,
		mementos,
		services: {
			db: archive.db,
			store: storage,
			maxUploadBytes,
			maxTweetMediaBytes: config.media.max_tweet_media_mb * 1e6,
			timeoutMs: config.media.fetch_timeout_seconds * 1000,
			log: (message) => log('fetch', message)
		}
	};
}
