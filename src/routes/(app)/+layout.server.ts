import { collectionOptions } from '$lib/server/db/collections.ts';
import { scopeOf } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { LayoutServerLoad } from './$types';

/** What every page in the Den needs: the persona's collections and what is switched on. */
export const load: LayoutServerLoad = async ({ locals }) => {
	const app = await runtime();
	return {
		collections: collectionOptions(app.archive.db, scopeOf(locals)),
		mementos: Boolean(app.zipline)
	};
};
