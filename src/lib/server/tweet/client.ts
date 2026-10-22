import { describeFetchError, safeFetch, type FetchLike } from '../safe-fetch.ts';
import {
	fromFxTwitter,
	fromVxTwitter,
	parseBody,
	TweetParseError,
	type NormalTweet
} from './normalise.ts';

export const API_HOSTS = new Set(['api.fxtwitter.com', 'api.vxtwitter.com']);

export interface TweetClientOptions {
	readonly timeoutMs: number;
	readonly fetchImpl?: FetchLike;
}

export class TweetFetchError extends Error {
	override readonly name = 'TweetFetchError';
	readonly missing: boolean;
	constructor(message: string, missing: boolean) {
		super(message);
		this.missing = missing;
	}
}

/**
 * Reads a tweet through FxTwitter, then vxTwitter if that fails. Throws a TweetFetchError
 * naming both reasons when neither works.
 */
export async function fetchTweet(id: string, options: TweetClientOptions): Promise<NormalTweet> {
	if (!/^\d{1,20}$/.test(id)) throw new TweetFetchError('Not a tweet id.', true);
	const sources = [
		{ name: 'FxTwitter', url: `https://api.fxtwitter.com/status/${id}`, read: fromFxTwitter },
		{
			name: 'vxTwitter',
			url: `https://api.vxtwitter.com/Twitter/status/${id}`,
			read: fromVxTwitter
		}
	];
	const reasons: string[] = [];
	let missing = true;
	for (const source of sources) {
		try {
			const response = await safeFetch(source.url, {
				allowedHosts: API_HOSTS,
				timeoutMs: options.timeoutMs,
				maxBytes: 2_000_000,
				accept: 'application/json',
				fetchImpl: options.fetchImpl
			});
			const body = response.body.toString('utf8');
			if (response.status >= 500) throw new Error(`${source.name} answered ${response.status}.`);
			return source.read(parseBody(body));
		} catch (error) {
			if (!(error instanceof TweetParseError && error.missing)) missing = false;
			const reason = describeFetchError(error);
			reasons.push(reason.startsWith(source.name) ? reason : `${source.name}: ${reason}`);
		}
	}
	throw new TweetFetchError(reasons.join(' · '), missing);
}
