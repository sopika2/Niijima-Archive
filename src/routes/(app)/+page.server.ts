import { fail } from '@sveltejs/kit';
import { getCollection, unsortedCount } from '$lib/server/db/collections.ts';
import { countItems, getItem, listItems, listTags, moveItems } from '$lib/server/db/items.ts';
import { filterFromUrl } from '$lib/server/filters.ts';
import { readCollection, scopeOf } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import { removeItems } from '$lib/server/save.ts';
import type { Actions, PageServerLoad } from './$types';

/** The Den: everything stolen, newest first, filtered by what is in the address. */
export const load: PageServerLoad = async ({ url, locals }) => {
	const app = await runtime();
	const { db } = app.archive;
	const scope = scopeOf(locals);
	const filter = { ...filterFromUrl(url), scope };
	const page = listItems(db, filter, { limit: app.config.gallery.page_size });
	const collection =
		filter.collectionId === 'none'
			? { id: 'none', name: 'Unsorted', owner: 'shared' as const }
			: filter.collectionId
				? getCollection(db, filter.collectionId, scope)
				: null;
	const opened = url.searchParams.get('item');
	return {
		filter: {
			q: filter.q ?? '',
			kind: filter.kind ?? '',
			collectionId: filter.collectionId ?? '',
			tag: filter.tag ?? ''
		},
		filtered: Boolean(filter.q || filter.kind || filter.collectionId || filter.tag),
		page,
		count: countItems(db, filter),
		total: countItems(db, { scope }),
		unsorted: unsortedCount(db, scope),
		tags: listTags(db, scope).slice(0, 40),
		collection: collection
			? { id: collection.id, name: collection.name, owner: collection.owner }
			: null,
		opened: opened && /^[a-z0-9]{8,32}$/.test(opened) ? getItem(db, opened, scope) : null
	};
};

const ids = (form: FormData) =>
	form
		.getAll('ids')
		.map(String)
		.filter((id) => /^[a-z0-9]{8,32}$/.test(id))
		.slice(0, 500);

export const actions: Actions = {
	/** Bulk: move the selected items into a collection ("" = unsorted). */
	move: async ({ request, locals }) => {
		const app = await runtime();
		const form = await request.formData();
		const scope = scopeOf(locals);
		const target = String(form.get('collection') ?? '');
		const collectionId = readCollection(app.archive.db, target, scope);
		if (target && !collectionId) return fail(400, { message: 'That collection is gone.' });
		const moved = moveItems(app.archive.db, ids(form), collectionId, scope);
		return { message: `Moved ${moved} item${moved === 1 ? '' : 's'}.` };
	},
	/** Bulk: delete the selected items and their files (on Mementos too, if she ticked it). */
	delete: async ({ request, locals }) => {
		const app = await runtime();
		const form = await request.formData();
		const alsoZipline = form.get('zipline') === '1';
		const { deleted, ziplineFailed } = await removeItems(app.services, ids(form), scopeOf(locals), {
			alsoZipline
		});
		const where = alsoZipline ? ' here and on Mementos' : '';
		const failed =
			ziplineFailed > 0 ? ` ${ziplineFailed} file(s) couldn't be deleted on Mementos.` : '';
		return { message: `Deleted ${deleted} item${deleted === 1 ? '' : 's'}${where}.${failed}` };
	}
};
