import { error } from '@sveltejs/kit';
import { join, resolve, sep } from 'node:path';
import { serveFile } from '$lib/server/media/serve.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	avif: 'image/avif',
	gif: 'image/gif'
};

/**
 * The owner's own art (the host's picture), from the assets folder mounted next to
 * compose.yml. Nothing in it is ever committed; this repo is public.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const match = /^[\w-]+(\/[\w-]+)*\.(png|jpe?g|webp|avif|gif)$/i.exec(params.file);
	if (!match) error(404, 'Not found');
	const app = await runtime();
	const root = resolve(app.paths.assets);
	const path = resolve(join(root, params.file));
	if (!path.startsWith(root + sep)) error(404, 'Not found');
	const response = await serveFile(path, request, {
		contentType: TYPES[match[2]!.toLowerCase()]!,
		cacheControl: 'public, max-age=3600'
	});
	if (!response) error(404, 'Not found');
	return response;
};
