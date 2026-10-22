import { error } from '@sveltejs/kit';
import { getCollection } from '$lib/server/db/collections.ts';
import { exportZip, slug } from '$lib/server/export.ts';
import { scopeOf } from '$lib/server/request.ts';
import { log } from '$lib/server/log.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/** A collection as a .zip: its files and a captions.json. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const app = await runtime();
	const scope = scopeOf(locals);
	const unsorted = params.id === 'none';
	const collection = unsorted ? null : getCollection(app.archive.db, params.id, scope);
	if (!unsorted && !collection) error(404, 'No such collection');
	const title = collection?.name ?? 'Unsorted';
	const stream = exportZip(
		app.archive.db,
		app.storage,
		{ scope, collectionId: params.id },
		title,
		(message) => log('export', message)
	);
	return new Response(stream, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${slug(title)}.zip"`,
			'cache-control': 'no-store'
		}
	});
};
