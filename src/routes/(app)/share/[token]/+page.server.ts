import { error, fail, redirect } from '@sveltejs/kit';
import { MediaRejected } from '$lib/server/media/store.ts';
import { readCollection, readOwner, scopeOf, text } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import { saveTweet, saveUpload } from '$lib/server/save.ts';
import { findTweetUrl, findUrl } from '$lib/server/tweet/url.ts';
import type { Actions, PageServerLoad } from './$types';

/** What the phone shared, waiting for her caption. */
export const load: PageServerLoad = async ({ params }) => {
	const app = await runtime();
	const staged = await app.inbox.read(params.token);
	if (!staged) error(404, 'This share has already been saved or discarded.');
	const tweet = findTweetUrl(staged.url, staged.text, staged.title);
	return {
		token: staged.token,
		files: staged.files.map((file, index) => ({
			...file,
			src: `/share/${staged.token}/file/${index}`
		})),
		rejected: staged.rejected,
		tweetUrl: tweet?.url ?? null,
		link: findUrl(staged.url, staged.text),
		// Whatever text came along that isn't the link makes a good starting caption.
		suggested: [staged.title, staged.text]
			.join(' ')
			.replace(/https?:\/\/\S+/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 300)
	};
};

export const actions: Actions = {
	save: async ({ request, params, locals }) => {
		const app = await runtime();
		const staged = await app.inbox.read(params.token);
		if (!staged) error(404, 'This share has already been saved or discarded.');
		const form = await request.formData();
		const scope = scopeOf(locals);
		const placement = {
			owner: readOwner(form.get('owner'), locals.persona),
			collectionId: readCollection(app.archive.db, form.get('collection'), scope),
			tags: text(form, 'tags', 500)
		};
		const caption = text(form, 'caption');
		const tweet = findTweetUrl(staged.url, staged.text, staged.title);
		let first: string | null = null;

		if (staged.files.length > 0) {
			const errors: string[] = [];
			for (let index = 0; index < staged.files.length; index++) {
				const bytes = await app.inbox.bytes(staged.token, index);
				if (!bytes) continue;
				try {
					const id = await saveUpload(
						app.services,
						{ bytes, caption, sourceUrl: tweet?.url ?? findUrl(staged.url, staged.text) },
						placement
					);
					first ??= id;
				} catch (problem) {
					if (!(problem instanceof MediaRejected)) throw problem;
					errors.push(problem.message);
				}
			}
			if (!first) return fail(400, { message: errors[0] ?? 'Nothing could be saved.' });
		} else if (tweet) {
			first = (await saveTweet(app.services, tweet, { ...placement, caption }, scope)).id;
		} else {
			return fail(400, { message: 'Nothing to save: share a tweet link or pictures.' });
		}
		await app.inbox.discard(staged.token);
		redirect(303, `/?item=${first}`);
	},
	discard: async ({ params }) => {
		const app = await runtime();
		await app.inbox.discard(params.token);
		redirect(303, '/');
	}
};
