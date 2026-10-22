import { redirect } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime.ts';
import { SESSION_COOKIE, sessionCookieOptions } from '$lib/server/session.ts';
import type { RequestHandler } from './$types';

/** Signs you out on this device (on every Niijima app, when the cookie is shared). */
export const POST: RequestHandler = async ({ cookies, url }) => {
	const app = await runtime();
	cookies.delete(
		SESSION_COOKIE,
		sessionCookieOptions(url.protocol === 'https:', app.access.cookieDomain)
	);
	redirect(303, '/signin?m=signed_out');
};
