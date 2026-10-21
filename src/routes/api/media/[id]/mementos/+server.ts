import { error, json } from '@sveltejs/kit';
import { getMedia, updateMedia } from '$lib/server/db/items.ts';
import { logError } from '$lib/server/log.ts';
import { scopeOf } from '$lib/server/request.ts';
import { runtime } from '$lib/server/runtime.ts';
import { uploadToZipline } from '$lib/server/zipline.ts';
import type { RequestHandler } from './$types';

/** "Copy Mementos link": uploads the file to Zipline once, then reuses the stored link. */
export const POST: RequestHandler = async ({ params, locals }) => {
	const app = await runtime();
	if (!app.zipline) error(404, 'Mementos is not set up.');
	const file = getMedia(app.archive.db, params.id, scopeOf(locals));
	if (!file?.path) error(404, 'Not found');
	if (file.mirrorUrl) return json({ url: file.mirrorUrl });
	const path = app.store.absolute(file.path);
	if (!path) error(404, 'Not found');
	try {
		const url = await uploadToZipline(app.zipline, {
			path,
			mime: file.mime ?? 'application/octet-stream',
			name: file.path.split('/').pop()
		});
		updateMedia(app.archive.db, file.id, { mirrorUrl: url });
		return json({ url });
	} catch (problem) {
		logError('mementos', problem);
		return json(
			{ error: problem instanceof Error ? problem.message : 'Mementos did not answer.' },
			{ status: 502 }
		);
	}
};
