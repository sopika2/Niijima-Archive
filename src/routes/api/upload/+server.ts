import { error, json } from '@sveltejs/kit';
import { MediaRejected } from '$lib/server/media/store.ts';
import { readCollection, readOwner, scopeOf, text } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import { saveUpload } from '$lib/server/save.ts';
import type { RequestHandler } from './$types';

/** One file from the Steal page (it uploads them one at a time, with progress). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const app = await runtime();
	const form = await request.formData().catch(() => null);
	const file = form?.get('file');
	if (!form || !(file instanceof File) || file.size === 0) error(400, 'No file.');
	const scope = scopeOf(locals);
	const poster = form.get('poster');
	try {
		const id = await saveUpload(
			app.services,
			{
				bytes: Buffer.from(await file.arrayBuffer()),
				poster:
					poster instanceof File && poster.size > 0
						? Buffer.from(await poster.arrayBuffer())
						: null,
				caption: text(form, 'caption'),
				sourceUrl: text(form, 'source', 2000)
			},
			{
				owner: readOwner(form.get('owner'), locals.persona),
				collectionId: readCollection(app.archive.db, form.get('collection'), scope),
				tags: text(form, 'tags', 500)
			}
		);
		return json({ ok: true, id }, { status: 201 });
	} catch (problem) {
		if (problem instanceof MediaRejected)
			return json({ ok: false, error: problem.message }, { status: 415 });
		throw problem;
	}
};
