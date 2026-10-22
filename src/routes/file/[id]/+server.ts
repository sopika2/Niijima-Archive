import { error } from '@sveltejs/kit';
import { getMedia } from '$lib/server/db/items.ts';
import { proxyZipline } from '$lib/server/media/proxy.ts';
import { serveFile } from '$lib/server/media/serve.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/**
 * A saved file by its id: from the Archive's disk while it is still there, otherwise streamed
 * from Zipline. Like /media, only for whoever is signed in (the hooks see to that).
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const app = await runtime();
	if (!/^[a-z0-9]{8,32}$/.test(params.id)) error(404, 'Not found');
	const file = getMedia(app.archive.db, params.id);
	if (!file) error(404, 'Not found');
	const cacheControl = 'private, max-age=604800';
	if (file.path) {
		const path = await app.store.locate(file.path);
		const response = path
			? await serveFile(path, request, {
					contentType: file.mime ?? 'application/octet-stream',
					cacheControl
				})
			: null;
		if (response) return response;
	}
	if (!file.ziplineId || !app.zipline) error(404, 'Not found');
	try {
		const response = await proxyZipline(
			app.zipline,
			{ ...file, ziplineId: file.ziplineId },
			request,
			{
				cacheControl
			}
		);
		if (!response) error(404, 'Deleted on Mementos');
		return response;
	} catch (problem) {
		if (request.signal.aborted) return new Response(null, { status: 499 });
		if (problem instanceof Error && problem.name === 'ZiplineError') error(502, problem.message);
		throw problem;
	}
};
