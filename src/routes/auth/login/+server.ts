import { redirect } from '@sveltejs/kit';
import { authorizeUrl } from '$lib/server/discord.ts';
import { safeNext } from '$lib/server/next.ts';
import { runtime } from '$lib/server/runtime.ts';
import { randomState } from '$lib/server/session.ts';
import type { RequestHandler } from './$types';

/** The sign-in button: remembers where you were going, then sends you to Discord. */
export const GET: RequestHandler = async ({ cookies, url }) => {
	const app = await runtime();
	if (!app.access.discord) redirect(303, '/');

	const options = {
		path: '/auth',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 600
	} as const;
	const state = randomState();
	cookies.set('nj_oauth_state', state, options);
	cookies.set('nj_oauth_next', safeNext(url.searchParams.get('next')), options);

	// SvelteKit's redirect() only allows same-site targets; Discord is deliberate here.
	return new Response(null, {
		status: 303,
		headers: { location: authorizeUrl(app.access.discord, state) }
	});
};
