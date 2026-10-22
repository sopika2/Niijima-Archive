import { describe, expect, it } from 'vitest';
import { discordAccess } from './access.ts';
import { createSession, readSession, SESSION_COOKIE, sessionCookieOptions } from './session.ts';

const secret = 'test-secret-0123456789abcdef';
const user = { id: '1234567890123456789', name: 'Makoto' };

describe('login sessions', () => {
	it('reads back a cookie it signed', () => {
		expect(readSession(createSession(user, secret), secret)).toEqual({ ...user, renew: false });
	});

	it('rejects a tampered, foreign or expired cookie', () => {
		const value = createSession(user, secret);
		const [body, signature] = value.split('.');
		const forged = Buffer.from(
			JSON.stringify({ ...user, id: '999999999999999999', exp: 9e9 })
		).toString('base64url');
		expect(readSession(`${forged}.${signature}`, secret)).toBeNull();
		expect(readSession(`${body}.x${signature}`, secret)).toBeNull();
		expect(readSession(value, 'another-secret')).toBeNull();
		expect(readSession(value, secret, Date.now() + 396 * 86_400_000)).toBeNull();
		expect(readSession(undefined, secret)).toBeNull();
	});

	it('only lets in Discord accounts listed in config.yml', () => {
		const gate = discordAccess({
			app: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/auth/callback' },
			sessionSecret: secret,
			allowedIds: [user.id]
		});
		const cookies = (value: string) => ({
			get: (name: string) => (name === SESSION_COOKIE ? value : undefined)
		});
		expect(gate.verify(cookies(createSession(user, secret)))).toMatchObject(user);
		expect(
			gate.verify(cookies(createSession({ id: '111111111111111111', name: 'x' }, secret)))
		).toBeNull();
		expect(gate.allows('111111111111111111')).toBe(false);
	});

	it('asks to renew once the cookie is a day old, so the login never runs out while used', () => {
		const issued = Date.now();
		const value = createSession(user, secret, issued);
		expect(readSession(value, secret, issued + 3_600_000)?.renew).toBe(false);
		expect(readSession(value, secret, issued + 2 * 86_400_000)?.renew).toBe(true);
	});

	it('uses the Network-wide nj_session cookie, on SESSION_DOMAIN when set', () => {
		expect(SESSION_COOKIE).toBe('nj_session');
		expect(sessionCookieOptions(true, 'niijimasisters.com', 60)).toEqual({
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			maxAge: 60,
			domain: 'niijimasisters.com'
		});
		expect(sessionCookieOptions(false, null)).not.toHaveProperty('domain');
	});
});
