import { fail } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime.ts';
import type { Actions, PageServerLoad } from './$types';

/** Mementos: where the files live, how the move to Zipline is going, and the sync. */
export const load: PageServerLoad = async () => {
	const app = await runtime();
	return {
		status: app.mementos?.status() ?? null,
		inbox: app.config.zipline.inbox_collection,
		folder: app.config.zipline.folder
	};
};

export const actions: Actions = {
	/** "Sync now": runs in the background; the page follows along. */
	sync: async () => {
		const app = await runtime();
		if (!app.mementos) return fail(404, { message: 'Mementos is not set up.' });
		void app.mementos.run();
		return { message: 'Syncing with Mementos…' };
	},
	/** Files that failed to move get another go. */
	retry: async () => {
		const app = await runtime();
		if (!app.mementos) return fail(404, { message: 'Mementos is not set up.' });
		void app.mementos.retry();
		return { message: 'Trying the files that failed again…' };
	}
};
