import { exportZip } from '$lib/server/export.ts';
import { scopeOf } from '$lib/server/request.ts';
import { log } from '$lib/server/log.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/** Everything this persona sees, as one .zip: a backup you can open anywhere. */
export const GET: RequestHandler = async ({ locals }) => {
	const app = await runtime();
	const stream = exportZip(
		app.archive.db,
		app.storage,
		{ scope: scopeOf(locals) },
		'Thieves Den',
		(message) => log('export', message)
	);
	const day = new Date().toISOString().slice(0, 10);
	return new Response(stream, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="thieves-den-${locals.persona}-${day}.zip"`,
			'cache-control': 'no-store'
		}
	});
};
