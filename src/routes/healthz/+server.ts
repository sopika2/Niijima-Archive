import { json } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/** For the container health check: the database answers and the media folder takes writes. */
export const GET: RequestHandler = async () => {
	const app = await runtime();
	let database = true;
	try {
		app.archive.sqlite.prepare('SELECT 1').get();
	} catch {
		database = false;
	}
	const media = await app.store.writable();
	return json(
		{
			status: database && media ? 'ok' : database ? 'degraded' : 'down',
			version: app.version,
			database,
			media,
			// Where files are kept; a Mementos outage doesn't fail the check (saves fall back to disk).
			storage: app.storage.mode,
			...(app.mementos ? { mementos: app.mementos.status().connection.state } : {})
		},
		{ status: database ? 200 : 503, headers: { 'cache-control': 'no-store' } }
	);
};
