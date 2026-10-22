import { error, json } from '@sveltejs/kit';
import { getMedia, updateMedia } from '$lib/server/db/items.ts';
import { logError } from '$lib/server/log.ts';
import { nameFromLink } from '$lib/server/zipline.ts';
import { scopeOf } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/**
 * The Mementos link of a file. Every file gets one when it is saved; one still waiting for the
 * migration is moved to Zipline right now instead.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const app = await runtime();
	if (!app.zipline) error(404, 'Mementos is not set up.');
	const file = getMedia(app.archive.db, params.id, scopeOf(locals));
	if (!file || (!file.path && !file.ziplineId)) error(404, 'Not found');
	if (file.mirrorUrl) return json({ url: file.mirrorUrl });
	if (!file.path) error(404, 'Not found');
	try {
		const result = await app.storage.migrate({
			path: file.path,
			mime: file.mime,
			name: file.path.split('/').pop()!,
			existing:
				file.ziplineId || file.mirrorUrl
					? { id: file.ziplineId, name: file.ziplineName ?? nameFromLink(file.mirrorUrl) }
					: null,
			onUploaded: (link) => updateMedia(app.archive.db, file.id, link)
		});
		if (result.status === 'missing') error(404, 'The file is missing from the disk.');
		updateMedia(app.archive.db, file.id, {
			ziplineId: result.ziplineId,
			ziplineName: result.ziplineName,
			mirrorUrl: result.mirrorUrl,
			...(result.status === 'moved'
				? { path: null, storageNote: null }
				: { keepLocal: result.status === 'changed', storageNote: result.note ?? null })
		});
		return json({ url: result.mirrorUrl });
	} catch (problem) {
		if (!(problem instanceof Error)) throw problem;
		logError('mementos', problem);
		return json({ error: problem.message || 'Mementos did not answer.' }, { status: 502 });
	}
};
