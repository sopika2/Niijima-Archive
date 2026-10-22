import { error } from '@sveltejs/kit';
import { MIME_BY_EXT } from '$lib/server/media/magic.ts';
import { serveFile } from '$lib/server/media/serve.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/**
 * Saved files and thumbnails, only for whoever is signed in (the hooks see to that). A file's
 * name is its random id and never changes, so browsers may keep it for a year.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const app = await runtime();
	const path = await app.store.locate(params.path);
	if (!path) error(404, 'Not found');
	const ext = params.path.split('.').pop()!;
	const response = await serveFile(path, request, {
		contentType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
		cacheControl: 'private, max-age=31536000, immutable'
	});
	if (!response) error(404, 'Not found');
	return response;
};
