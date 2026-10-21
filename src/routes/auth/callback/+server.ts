import { redirect } from '@sveltejs/kit';
import { userFromCode } from '$lib/server/discord.ts';
import { log } from '$lib/server/log.ts';
import { safeNext } from '$lib/server/next.ts';
import { runtime } from '$lib/server/runtime.ts';
import {
	createSession,
	SESSION_COOKIE,
	SESSION_DAYS,
	sessionCookieOptions
} from '$lib/server/session.ts';
import type { RequestHandler } from './$types';

/** Discord sends you back here. Problems go back to the sign-in screen with a message. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const app = await runtime();
	if (!app.access.discord) redirect(303, '/');

	const expected = cookies.get('nj_oauth_state');
	const next = safeNext(cookies.get('nj_oauth_next'));
	cookies.delete('nj_oauth_state', { path: '/auth' });
	cookies.delete('nj_oauth_next', { path: '/auth' });

	const code = url.searchParams.get('code');
	if (!code || !expected || url.searchParams.get('state') !== expected) {
		redirect(303, '/signin?m=expired');
	}

	let user;
	try {
		user = await userFromCode(app.access.discord, code);
	} catch (error) {
		log('auth', `Discord sign-in failed: ${error instanceof Error ? error.message : error}`);
		redirect(303, '/signin?m=failed');
	}

	if (!app.access.allows(user.id)) {
		log('auth', `refused Discord account ${user.id} (${user.name})`);
		redirect(303, `/signin?m=refused&id=${user.id}`);
	}

	cookies.set(
		SESSION_COOKIE,
		createSession(user, app.access.sessionSecret),
		sessionCookieOptions(url.protocol === 'https:', app.access.cookieDomain, SESSION_DAYS * 86_400)
	);
	log('auth', `signed in: ${user.name}`);
	redirect(303, next);
};
