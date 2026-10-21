import { fail, redirect } from '@sveltejs/kit';
import { createCollection, listCollections, unsortedCount } from '$lib/server/db/collections.ts';
import { readOwner, scopeOf, text } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const app = await runtime();
	const scope = scopeOf(locals);
	return {
		list: listCollections(app.archive.db, scope),
		unsorted: unsortedCount(app.archive.db, scope)
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const app = await runtime();
		const form = await request.formData();
		const name = text(form, 'name', 80);
		if (!name) return fail(400, { message: 'Give it a name.' });
		const id = createCollection(app.archive.db, {
			name,
			owner: readOwner(form.get('owner'), locals.persona)
		});
		redirect(303, `/?c=${id}`);
	}
};
