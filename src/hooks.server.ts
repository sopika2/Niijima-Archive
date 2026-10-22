import { building } from '$app/environment';
import { personaFromCookie } from '@niijima/design';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { originAllowed, SHARE_PATH } from '$lib/server/guard.ts';
import { runtime } from '$lib/server/runtime.ts';
import {
	createSession,
	SESSION_COOKIE,
	SESSION_DAYS,
	sessionCookieOptions
} from '$lib/server/session.ts';

/**
 * Reachable without signing in: the container health check, the sign-in screen and flow, the
 * host's art (the sign-in screen shows her), and /api/save, which checks its own bearer token.
 * The manifest, icons and service worker are static files and never reach these hooks.
 */
const OPEN_PATHS = new Set(['/signin', '/healthz', '/auth/login', '/auth/callback', '/api/save']);
const OPEN_PREFIXES = ['/assets/'];

const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'no-referrer',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
	'cross-origin-opener-policy': 'same-origin'
};

const text = (status: number, body: string) =>
	new Response(body, {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }
	});

export const init: ServerInit = async () => {
	if (!building) await runtime();
};

export const handle: Handle = async ({ event, resolve }) => {
	const app = await runtime();
	const path = event.url.pathname;
	event.locals.user = null;
	event.locals.persona = personaFromCookie(event.request.headers.get('cookie')) ?? 'makoto';

	if (
		!originAllowed({
			method: event.request.method,
			path,
			origin: event.request.headers.get('origin'),
			allowed: [event.url.origin, ...app.origins]
		})
	) {
		return text(403, 'Cross-site requests are not allowed.');
	}

	const open = OPEN_PATHS.has(path) || OPEN_PREFIXES.some((prefix) => path.startsWith(prefix));
	if (!open && app.access.mode === 'discord') {
		const user = app.access.verify(event.cookies);
		if (!user) {
			const method = event.request.method;
			// A share from the phone can't survive the trip through Discord; land on Steal after.
			if (path === SHARE_PATH && method === 'POST')
				return new Response(null, {
					status: 303,
					headers: { location: '/signin?next=%2Fadd', ...SECURITY_HEADERS }
				});
			if (
				method === 'GET' &&
				!event.isDataRequest &&
				!path.startsWith('/api/') &&
				!path.startsWith('/media/') &&
				!path.startsWith('/file/')
			) {
				const target = path + event.url.search;
				const location = target === '/' ? '/signin' : `/signin?next=${encodeURIComponent(target)}`;
				return new Response(null, { status: 303, headers: { location, ...SECURITY_HEADERS } });
			}
			return text(401, 'Sign in first.');
		}
		event.locals.user = { id: user.id, name: user.name };
		// Sliding login: each visit pushes the expiry forward, so you only sign in once.
		if (user.renew) {
			event.cookies.set(
				SESSION_COOKIE,
				createSession(event.locals.user, app.access.sessionSecret),
				sessionCookieOptions(
					event.url.protocol === 'https:',
					app.access.cookieDomain,
					SESSION_DAYS * 86_400
				)
			);
		}
	}

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%nj.persona%', event.locals.persona)
	});
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}
	return response;
};
