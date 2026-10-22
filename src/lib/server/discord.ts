/**
 * Sign in with Discord (OAuth2, "identify" scope only: the app learns your Discord id and name,
 * nothing else). Set up at https://discord.com/developers/applications.
 */
export interface DiscordApp {
	readonly clientId: string;
	readonly clientSecret: string;
	/** Must match a Redirect in the Discord app exactly, e.g. https://archive.niijimasisters.com/auth/callback */
	readonly redirectUri: string;
}

export interface DiscordUser {
	readonly id: string;
	readonly name: string;
}

const API = 'https://discord.com/api/v10';

export function authorizeUrl(app: DiscordApp, state: string): string {
	const params = new URLSearchParams({
		client_id: app.clientId,
		redirect_uri: app.redirectUri,
		response_type: 'code',
		scope: 'identify',
		state,
		prompt: 'none'
	});
	return `https://discord.com/oauth2/authorize?${params}`;
}

/** Trades the one-time code Discord sent back for the signed-in user. */
export async function userFromCode(app: DiscordApp, code: string): Promise<DiscordUser> {
	const tokenResponse = await fetch(`${API}/oauth2/token`, {
		method: 'POST',
		signal: AbortSignal.timeout(10_000),
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: app.clientId,
			client_secret: app.clientSecret,
			grant_type: 'authorization_code',
			code,
			redirect_uri: app.redirectUri
		})
	});
	if (!tokenResponse.ok) {
		throw new Error(`Discord refused the sign-in code (${tokenResponse.status}).`);
	}
	const { access_token: token } = (await tokenResponse.json()) as { access_token?: string };
	if (!token) throw new Error('Discord did not return an access token.');

	const userResponse = await fetch(`${API}/users/@me`, {
		headers: { authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(10_000)
	});
	if (!userResponse.ok)
		throw new Error(`Discord did not return the user (${userResponse.status}).`);
	const user = (await userResponse.json()) as {
		id?: string;
		username?: string;
		global_name?: string | null;
	};
	if (!user.id) throw new Error('Discord did not return a user id.');
	return { id: user.id, name: user.global_name || user.username || user.id };
}
