import { createHash, timingSafeEqual } from 'node:crypto';

/** Paths that answer to a bearer token instead of the sign-in cookie. */
export const TOKEN_PATHS = new Set(['/api/save']);
/** Android's share sheet posts here as a navigation, without an Origin header. */
export const SHARE_PATH = '/share';

/**
 * Cross-site request forgery check for everything that changes data. A browser always sends
 * Origin with a POST from a page, so it has to be this site. Two exceptions: /api/save ignores
 * cookies entirely (it needs the bearer token), and /share accepts a missing or "null" Origin,
 * which is how Android's share sheet arrives; it only stages files for the signed-in user to
 * confirm, and the SameSite=Lax cookie never rides along on another site's POST.
 */
export function originAllowed(request: {
	readonly method: string;
	readonly path: string;
	readonly origin: string | null;
	readonly allowed: readonly string[];
}): boolean {
	if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
	if (TOKEN_PATHS.has(request.path)) return true;
	if (request.origin && request.allowed.includes(request.origin)) return true;
	return request.path === SHARE_PATH && (!request.origin || request.origin === 'null');
}

/** Whether an Authorization header carries the save token. Constant time; off without a token. */
export function bearerAllowed(
	header: string | null | undefined,
	token: string | null | undefined
): boolean {
	if (!token) return false;
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
	if (!match) return false;
	const digest = (text: string) => createHash('sha256').update(text).digest();
	return timingSafeEqual(digest(match[1]!), digest(token));
}
