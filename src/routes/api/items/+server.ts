import { json } from '@sveltejs/kit';
import { listItems } from '$lib/server/db/items.ts';
import { scopeOf } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import { filterFromUrl } from '$lib/server/filters.ts';
import type { RequestHandler } from './$types';

/** The next page of the gallery while scrolling, with the same filters as the page. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const app = await runtime();
	const page = listItems(
		app.archive.db,
		{ ...filterFromUrl(url), scope: scopeOf(locals) },
		{ cursor: url.searchParams.get('cursor'), limit: app.config.gallery.page_size }
	);
	return json(page, { headers: { 'cache-control': 'no-store' } });
};
