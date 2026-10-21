import { fail } from '@sveltejs/kit';
import { MediaRejected } from '$lib/server/media/store.ts';
import { readCollection, readOwner, scopeOf, text } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import { saveTweet, saveUpload } from '$lib/server/save.ts';
import { findTweetUrl } from '$lib/server/tweet/url.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const app = await runtime();
	return {
		collection: url.searchParams.get('c') ?? '',
		maxUploadMb: app.config.media.max_upload_mb
	};
};

export const actions: Actions = {
	/** A tweet link with her caption. A failed fetch still saves the link (retry later). */
	tweet: async ({ request, locals }) => {
		const app = await runtime();
		const form = await request.formData();
		const link = text(form, 'url', 2000);
		const ref = findTweetUrl(link);
		if (!ref)
			return fail(400, {
				tweet: { error: "That isn't a tweet link (x.com/…/status/…).", url: link }
			});
		const scope = scopeOf(locals);
		const saved = await saveTweet(
			app.services,
			ref,
			{
				owner: readOwner(form.get('owner'), locals.persona),
				collectionId: readCollection(app.archive.db, form.get('collection'), scope),
				caption: text(form, 'caption'),
				tags: text(form, 'tags', 500)
			},
			scope
		);
		return { tweet: { ...saved, url: '' } };
	},

	/** Pictures without JavaScript: every file at once, one caption for all. */
	upload: async ({ request, locals }) => {
		const app = await runtime();
		const form = await request.formData();
		const scope = scopeOf(locals);
		const files = form
			.getAll('files')
			.filter((value): value is File => value instanceof File && value.size > 0);
		if (files.length === 0)
			return fail(400, { upload: { error: 'Choose at least one file.', saved: 0, errors: [] } });
		const placement = {
			owner: readOwner(form.get('owner'), locals.persona),
			collectionId: readCollection(app.archive.db, form.get('collection'), scope),
			tags: text(form, 'tags', 500)
		};
		let saved = 0;
		const errors: string[] = [];
		for (const file of files) {
			try {
				await saveUpload(
					app.services,
					{
						bytes: Buffer.from(await file.arrayBuffer()),
						caption: text(form, 'caption'),
						sourceUrl: text(form, 'source', 2000)
					},
					placement
				);
				saved++;
			} catch (error) {
				if (!(error instanceof MediaRejected)) throw error;
				errors.push(`${file.name}: ${error.message}`);
			}
		}
		return { upload: { error: null, saved, errors } };
	}
};
