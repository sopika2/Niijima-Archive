import { error, fail, redirect } from '@sveltejs/kit';
import { deleteCollection, getCollection, updateCollection } from '$lib/server/db/collections.ts';
import { countItems } from '$lib/server/db/items.ts';
import { readOwner, scopeOf, text } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const app = await runtime();
	const scope = scopeOf(locals);
	const collection = getCollection(app.archive.db, params.id, scope);
	if (!collection) error(404, 'No such collection');
	return {
		collection: { id: collection.id, name: collection.name, owner: collection.owner },
		count: countItems(app.archive.db, { collectionId: collection.id })
	};
};

export const actions: Actions = {
	save: async ({ request, params, locals }) => {
		const app = await runtime();
		const form = await request.formData();
		const name = text(form, 'name', 80);
		if (!name) return fail(400, { message: 'Give it a name.' });
		const ok = updateCollection(app.archive.db, params.id, scopeOf(locals), {
			name,
			owner: readOwner(form.get('owner'), locals.persona)
		});
		if (!ok) error(404, 'No such collection');
		redirect(303, `/?c=${params.id}`);
	},
	clearCover: async ({ params, locals }) => {
		const app = await runtime();
		updateCollection(app.archive.db, params.id, scopeOf(locals), { coverItemId: null });
		return { message: 'The newest picture is the cover again.' };
	},
	delete: async ({ params, locals }) => {
		const app = await runtime();
		deleteCollection(app.archive.db, params.id, scopeOf(locals));
		redirect(303, '/collections');
	}
};
