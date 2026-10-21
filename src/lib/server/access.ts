import type { DiscordApp } from './discord.ts';
import { readSession, SESSION_COOKIE, type ReadSession, type SessionUser } from './session.ts';

export type AccessUser = SessionUser;
export type VerifiedUser = ReadSession;

export interface AccessGate {
	readonly mode: 'discord' | 'off';
	/** Returns the signed-in user, or null when the request is not allowed in. */
	verify(cookies: { get(name: string): string | undefined }): VerifiedUser | null;
	/** Whether a Discord account may use the app. */
	allows(discordId: string): boolean;
	readonly discord: DiscordApp | null;
	readonly sessionSecret: string;
	/** SESSION_DOMAIN: the parent domain the cookie is shared on, or null for this host only. */
	readonly cookieDomain: string | null;
}

/**
 * Only the Discord accounts listed in config.yml (access.discord_user_ids) get in. The list is
 * checked on every request, so removing an id signs that account out straight away.
 */
export function discordAccess(options: {
	readonly app: DiscordApp;
	readonly sessionSecret: string;
	readonly allowedIds: readonly string[];
	readonly cookieDomain?: string | null;
}): AccessGate {
	const allowed = new Set(options.allowedIds);
	return {
		mode: 'discord',
		discord: options.app,
		sessionSecret: options.sessionSecret,
		cookieDomain: options.cookieDomain ?? null,
		allows: (id) => allowed.has(id),
		verify(cookies) {
			const user = readSession(cookies.get(SESSION_COOKIE), options.sessionSecret);
			return user && allowed.has(user.id) ? user : null;
		}
	};
}

export function accessOff(): AccessGate {
	return {
		mode: 'off',
		discord: null,
		sessionSecret: '',
		cookieDomain: null,
		allows: () => true,
		verify: () => null
	};
}
