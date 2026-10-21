import { redirect } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime.ts';
import type { RequestHandler } from './$types';

/**
 * The PWA's share target: Android posts whatever was shared (a tweet link in `text` or `url`,
 * pictures in `media`). It is only staged here; the next screen asks for her caption.
 */
export const POST: RequestHandler = async ({ request }) => {
	const app = await runtime();
	const form = await request.formData().catch(() => null);
	if (!form) redirect(303, '/add');
	const field = (name: string) => String(form.get(name) ?? '');
	const files = form
		.getAll('media')
		.filter((value): value is File => value instanceof File && value.size > 0);
	const staged = await app.inbox.stage(
		{ title: field('title'), text: field('text'), url: field('url'), files },
		app.services.maxUploadBytes
	);
	redirect(303, `/share/${staged.token}`);
};
