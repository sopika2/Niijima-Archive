import { handleSave } from '$lib/server/api-save.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/** Saving from an iOS Shortcut (or curl): bearer token, no cookie. See README. */
export const POST: RequestHandler = async ({ request, url }) => {
	const app = await runtime();
	return handleSave(request, {
		services: app.services,
		token: app.saveToken,
		origin: app.publicUrl ?? url.origin
	});
};
