import { redirect } from '@sveltejs/kit';
import { safeNext } from '$lib/server/next.ts';
import { runtime } from '$lib/server/runtime.ts';
import type { PageServerLoad } from './$types';

const MESSAGES = new Set(['signed_out', 'expired', 'failed', 'refused']);

export const load: PageServerLoad = async ({ url, cookies }) => {
	const app = await runtime();
	const next = safeNext(url.searchParams.get('next'));
	if (app.access.mode === 'off' || app.access.verify(cookies)) redirect(303, next);

	const message = url.searchParams.get('m');
	const id = url.searchParams.get('id');
	return {
		next,
		message: message && MESSAGES.has(message) ? message : null,
		refusedId: id && /^\d{15,21}$/.test(id) ? id : null
	};
};
