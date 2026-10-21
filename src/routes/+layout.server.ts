import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runtime } from '$lib/server/runtime.ts';
import type { LayoutServerLoad } from './$types';

/** What every page needs, signed in or not: the persona and who greets you. */
export const load: LayoutServerLoad = async ({ locals }) => {
	const app = await runtime();
	const { host, locale, timezone } = app.config;
	const day = Math.floor(Date.now() / 86_400_000);
	// The art is checked on every page, so a picture dropped into assets/ shows without a restart.
	const art = existsSync(join(app.paths.assets, host.art.replace(/^\/assets\//, '')))
		? host.art
		: null;
	return {
		persona: locals.persona,
		user: locals.user,
		signedIn: app.access.mode === 'discord',
		host: { name: host.name, art, line: host.lines[day % host.lines.length]!, lines: host.lines },
		locale,
		timezone
	};
};
