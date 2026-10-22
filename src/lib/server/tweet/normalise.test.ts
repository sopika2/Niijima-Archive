import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchTweet, TweetFetchError } from './client.ts';
import {
	fromFxTwitter,
	fromVxTwitter,
	parseBody,
	pickVariant,
	TweetParseError
} from './normalise.ts';
import { findTweetUrl, parseTweetUrl } from './url.ts';

// Recorded answers from the real APIs (tests/fixtures/tweets). Tests never touch the network.
const dir = new URL('../../../../tests/fixtures/tweets/', import.meta.url);
const raw = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const fx = (id: string) => fromFxTwitter(JSON.parse(raw(`fx-${id}.json`)));
const vx = (id: string) => fromVxTwitter(JSON.parse(raw(`vx-${id}.json`)));

const ELLEN = '440322224407314432';
const CREW = '2108285056170996122';
const VIDEO = '2111180963661435219';
const GIF = '1724489664562659673';
const QUOTE = '2112667725805822220';

describe('tweet normaliser', () => {
	it('reads a text-only tweet the same from both APIs', () => {
		for (const tweet of [fx('20'), vx('20')]) {
			expect(tweet).toMatchObject({
				id: '20',
				url: 'https://x.com/jack/status/20',
				text: 'just setting up my twttr',
				authorName: 'jack',
				authorHandle: 'jack',
				postedAt: '2006-03-21T20:50:14.000Z',
				media: [],
				quote: null
			});
		}
	});

	it('takes photos at their original size, with sizes and alt text', () => {
		const a = fx(CREW);
		const b = vx(CREW);
		expect(a.media.map((m) => m.url)).toEqual([
			'https://pbs.twimg.com/media/HUIiFOpW8AABTfc.jpg?name=orig',
			'https://pbs.twimg.com/media/HUIiFb6W4AAwNM7.jpg?name=orig'
		]);
		expect(b.media.map((m) => m.url)).toEqual(a.media.map((m) => m.url));
		expect(a.media[0]).toMatchObject({ kind: 'image', width: 2048, height: 1365 });
		expect(a.media[0]!.alt).toMatch(/parachutes/);
		expect(a.text).toBe(b.text);
	});

	it("drops vxTwitter's trailing media link and keeps FxTwitter's clean text", () => {
		expect(fx(ELLEN).text).toBe("If only Bradley's arm was longer. Best photo ever. #oscars");
		expect(vx(ELLEN).text).toBe("If only Bradley's arm was longer. Best photo ever. #oscars");
	});

	it('reads videos with every MP4, best first, and a still frame', () => {
		const a = fx(VIDEO);
		expect(a.media).toHaveLength(1);
		const video = a.media[0]!;
		expect(video.kind).toBe('video');
		expect(video.durationMs).toBe(17751);
		expect(video.thumbnailUrl).toMatch(/^https:\/\/pbs\.twimg\.com\/amplify_video_thumb\//);
		expect(video.variants.map((v) => v.bitrate)).toEqual([10368000, 2176000, 950000, 632000]);
		expect(video.variants.every((v) => !v.url.includes('.m3u8'))).toBe(true);
		const b = vx(VIDEO).media[0]!;
		expect(b).toMatchObject({ kind: 'video', durationMs: 17751, width: 1080, height: 1920 });
	});

	it('picks a smaller MP4 when the best one is over the cap', () => {
		const video = fx(VIDEO).media[0]!;
		expect(pickVariant(video, 64e6)).toContain('1080x1920');
		expect(pickVariant(video, 8e6)).toContain('720x1280');
		expect(pickVariant(video, 1000)).toContain('320x568');
	});

	it('marks GIFs as GIFs (they arrive as MP4)', () => {
		for (const tweet of [fx(GIF), vx(GIF)]) {
			expect(tweet.media).toHaveLength(1);
			expect(tweet.media[0]).toMatchObject({
				kind: 'gif',
				url: 'https://video.twimg.com/tweet_video/F-6eMSKXwAAWfLJ.mp4',
				thumbnailUrl: 'https://pbs.twimg.com/tweet_video_thumb/F-6eMSKXwAAWfLJ.jpg'
			});
			expect(tweet.text).toBe('#NationalPickleDay');
		}
	});

	it('keeps the quoted tweet', () => {
		for (const tweet of [fx(QUOTE), vx(QUOTE)]) {
			expect(tweet.media).toHaveLength(4);
			expect(tweet.quote).toMatchObject({
				url: 'https://x.com/KDA_MUSIC/status/2112002511729205311',
				authorHandle: 'KDA_MUSIC'
			});
			expect(tweet.quote!.text).toMatch(/^Watch it burn\./);
		}
	});

	it('turns not-found answers into a "missing" error', () => {
		const notFound = () => fromFxTwitter(JSON.parse(raw('fx-not-found.json')));
		expect(notFound).toThrow(TweetParseError);
		expect(() => notFound()).toThrow(/NOT_FOUND/);
		try {
			parseBody(raw('vx-not-found.html'));
		} catch (error) {
			expect(error).toBeInstanceOf(TweetParseError);
			expect((error as TweetParseError).missing).toBe(true);
		}
		expect(() => fromVxTwitter({ text: 'no id' })).toThrow(TweetParseError);
		expect(() => fromFxTwitter('nope')).toThrow(TweetParseError);
	});

	it('only accepts media on the two Twitter file hosts', () => {
		const data = JSON.parse(raw(`fx-${CREW}.json`));
		data.tweet.media.all[0].url = 'https://evil.example/x.jpg';
		data.tweet.media.all[1].url = 'http://pbs.twimg.com/media/x.jpg';
		expect(fromFxTwitter(data).media).toEqual([]);
	});

	it('decodes the escaped characters the old API used', () => {
		const data = JSON.parse(raw('vx-20.json'));
		data.text = 'Tom &amp; Jerry &lt;3 <script>';
		expect(fromVxTwitter(data).text).toBe('Tom & Jerry <3 <script>');
	});
});

describe('tweet links', () => {
	it('understands every shape of tweet link', () => {
		for (const link of [
			'https://x.com/NASA/status/2111180963661435219',
			'https://twitter.com/NASA/status/2111180963661435219?s=20&t=abc',
			'https://mobile.twitter.com/NASA/status/2111180963661435219/photo/1',
			'https://www.fxtwitter.com/NASA/status/2111180963661435219',
			'http://vxtwitter.com/NASA/statuses/2111180963661435219'
		]) {
			expect(parseTweetUrl(link)).toEqual({
				id: '2111180963661435219',
				handle: 'NASA',
				url: 'https://x.com/NASA/status/2111180963661435219'
			});
		}
		expect(parseTweetUrl('https://x.com/i/web/status/20')).toMatchObject({
			id: '20',
			handle: null
		});
		expect(parseTweetUrl('https://example.com/NASA/status/1')).toBeNull();
		expect(parseTweetUrl('https://x.com/NASA')).toBeNull();
		expect(parseTweetUrl('javascript:alert(1)')).toBeNull();
	});

	it('finds the link in shared text', () => {
		expect(findTweetUrl(null, 'Look at this! https://x.com/jack/status/20?s=46 lol')?.id).toBe(
			'20'
		);
		expect(findTweetUrl('https://example.com/a', 'nothing here')).toBeNull();
	});
});

describe('tweet client', () => {
	const answer = (status: number, body: string, type = 'application/json') =>
		new Response(body, { status, headers: { 'content-type': type } });

	it('falls back to vxTwitter when FxTwitter fails', async () => {
		const asked: string[] = [];
		const tweet = await fetchTweet(GIF, {
			timeoutMs: 1000,
			fetchImpl: async (url) => {
				asked.push(new URL(url).hostname);
				return url.includes('fxtwitter')
					? answer(502, 'bad gateway', 'text/plain')
					: answer(200, raw(`vx-${GIF}.json`));
			}
		});
		expect(asked).toEqual(['api.fxtwitter.com', 'api.vxtwitter.com']);
		expect(tweet.source).toBe('vxtwitter');
		expect(tweet.media[0]!.kind).toBe('gif');
	});

	it('says why when both fail, and whether the tweet is gone', async () => {
		const gone = fetchTweet('1999999999999999999', {
			timeoutMs: 1000,
			fetchImpl: async (url) =>
				url.includes('fxtwitter')
					? answer(404, raw('fx-not-found.json'))
					: answer(200, raw('vx-not-found.html'), 'text/html')
		});
		await expect(gone).rejects.toBeInstanceOf(TweetFetchError);
		await expect(gone).rejects.toMatchObject({ missing: true });

		const offline = fetchTweet('20', {
			timeoutMs: 1000,
			fetchImpl: async () => {
				throw new TypeError('fetch failed');
			}
		});
		await expect(offline).rejects.toMatchObject({ missing: false });
		await expect(offline).rejects.toThrow(/FxTwitter: fetch failed · vxTwitter: fetch failed/);
	});

	it('does not follow redirects off the API hosts', async () => {
		const result = fetchTweet('20', {
			timeoutMs: 1000,
			fetchImpl: async () =>
				new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
		});
		await expect(result).rejects.toThrow(/evil\.example is not on the list/);
	});
});
