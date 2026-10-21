import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Who is signed in. Kept in a signed cookie, so no session table is needed. */
export interface SessionUser {
	readonly id: string;
	readonly name: string;
}

interface Payload extends SessionUser {
	/** Expiry, in seconds since 1970. */
	readonly exp: number;
}

/**
 * One cookie for the whole Network. Same payload and HMAC as every Niijima app: with the same
 * SESSION_SECRET everywhere and SESSION_DOMAIN=niijimasisters.com, signing in on one subdomain
 * signs you in on all of them.
 */
export const SESSION_COOKIE = 'nj_session';
/** About as long as browsers allow a cookie to live (400 days). Renewed on use, so it never runs out while you use the app. */
export const SESSION_DAYS = 395;
/** Renew the cookie once it is a day old. */
const RENEW_AFTER_SECONDS = 86_400;

const encode = (text: string) => Buffer.from(text).toString('base64url');
const decode = (text: string) => Buffer.from(text, 'base64url').toString('utf8');

function sign(body: string, secret: string): string {
	return createHmac('sha256', secret).update(body).digest('base64url');
}

/** A cookie value proving `user` signed in, valid for SESSION_DAYS. */
export function createSession(user: SessionUser, secret: string, now = Date.now()): string {
	const payload: Payload = { ...user, exp: Math.floor(now / 1000) + SESSION_DAYS * 86_400 };
	const body = encode(JSON.stringify(payload));
	return `${body}.${sign(body, secret)}`;
}

export interface ReadSession extends SessionUser {
	/** True when the cookie is old enough to be reissued with a fresh expiry. */
	readonly renew: boolean;
}

/** The user in a cookie value, or null when it is missing, tampered with or expired. */
export function readSession(
	value: string | undefined,
	secret: string,
	now = Date.now()
): ReadSession | null {
	if (!value) return null;
	const [body, signature] = value.split('.');
	if (!body || !signature) return null;
	const expected = Buffer.from(sign(body, secret));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	try {
		const payload = JSON.parse(decode(body)) as Payload;
		if (typeof payload.id !== 'string' || payload.exp * 1000 < now) return null;
		const issued = payload.exp - SESSION_DAYS * 86_400;
		return {
			id: payload.id,
			name: String(payload.name ?? ''),
			renew: now / 1000 - issued > RENEW_AFTER_SECONDS
		};
	} catch {
		return null;
	}
}

/** A random value for the OAuth `state` check. */
export function randomState(): string {
	return randomBytes(24).toString('base64url');
}

export interface CookieOptions {
	readonly path: '/';
	readonly httpOnly: true;
	readonly sameSite: 'lax';
	readonly secure: boolean;
	readonly maxAge?: number;
	readonly domain?: string;
}

/** How the session cookie is set and cleared: host-only, or on SESSION_DOMAIN when set. */
export function sessionCookieOptions(
	secure: boolean,
	domain: string | null,
	maxAge?: number
): CookieOptions {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		...(maxAge !== undefined ? { maxAge } : {}),
		...(domain ? { domain } : {})
	};
}
