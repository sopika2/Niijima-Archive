import { error } from '@sveltejs/kit';
import { serveFile } from '$lib/server/media/serve.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/** A preview of a file waiting in the share inbox. */
export const GET: RequestHandler = async ({ params, request }) => {
	const app = await runtime();
	const found = await app.inbox.file(params.token, Number(params.n));
	if (!found) error(404, 'Not found');
	const response = await serveFile(found.path, request, {
		contentType: found.mime,
		cacheControl: 'private, no-store'
	});
	if (!response) error(404, 'Not found');
	return response;
};
