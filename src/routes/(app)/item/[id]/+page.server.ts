import { error, fail, redirect } from '@sveltejs/kit';
import { updateCollection } from '$lib/server/db/collections.ts';
import { getItem, updateItem } from '$lib/server/db/items.ts';
import { readCollection, readOwner, scopeOf, text } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import { cleanUrl, fetchInto, removeItems } from '$lib/server/save.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const app = await runtime();
	const item = getItem(app.archive.db, params.id, scopeOf(locals));
	if (!item) error(404, 'Not in the Den');
	return { item };
};

export const actions: Actions = {
	save: async ({ request, params, locals }) => {
		const app = await runtime();
		const form = await request.formData();
		const scope = scopeOf(locals);
		const source = text(form, 'source', 2000);
		if (source && !cleanUrl(source))
			return fail(400, { message: 'The source has to be a web address.' });
		const ok = updateItem(app.archive.db, params.id, scope, {
			caption: text(form, 'caption'),
			tags: text(form, 'tags', 500),
			sourceUrl: cleanUrl(source),
			owner: readOwner(form.get('owner'), locals.persona),
			collectionId: readCollection(app.archive.db, form.get('collection'), scope)
		});
		if (!ok) error(404, 'Not in the Den');
		return { message: 'Saved.' };
	},
	refetch: async ({ params, locals }) => {
		const app = await runtime();
		const item = getItem(app.archive.db, params.id, scopeOf(locals));
		if (!item?.tweet) error(404, 'Not in the Den');
		const result = await fetchInto(app.services, item.id);
		return {
			message: result.fetched
				? result.error
					? `Read the tweet. ${result.error}`
					: 'Fetched again: everything is here.'
				: `Still can't read it: ${result.error}`
		};
	},
	cover: async ({ params, locals }) => {
		const app = await runtime();
		const scope = scopeOf(locals);
		const item = getItem(app.archive.db, params.id, scope);
		if (!item?.collection) return fail(400, { message: 'Put it in a collection first.' });
		updateCollection(app.archive.db, item.collection.id, scope, { coverItemId: item.id });
		return { message: `Now the cover of ${item.collection.name}.` };
	},
	delete: async ({ request, params, locals }) => {
		const app = await runtime();
		const form = await request.formData();
		await removeItems(app.services, [params.id], scopeOf(locals), {
			alsoZipline: form.get('zipline') === '1'
		});
		redirect(303, '/');
	}
};
