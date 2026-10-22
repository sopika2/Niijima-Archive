import { describe, expect, it } from 'vitest';
import { linkify } from './linkify.ts';

describe('tweet text', () => {
	it('splits links, mentions and hashtags out of plain text', () => {
		expect(linkify('Welcome @Space_Station! See https://go.nasa.gov/4elVwzA. #Crew12')).toEqual([
			{ kind: 'text', text: 'Welcome ' },
			{ kind: 'link', text: '@Space_Station', href: 'https://x.com/Space_Station' },
			{ kind: 'text', text: '! See ' },
			{ kind: 'link', text: 'go.nasa.gov/4elVwzA', href: 'https://go.nasa.gov/4elVwzA' },
			{ kind: 'text', text: '. ' },
			{ kind: 'link', text: '#Crew12', href: 'https://x.com/hashtag/Crew12' }
		]);
	});

	it('keeps markup as text and never links other schemes', () => {
		const parts = linkify('<img src=x onerror=alert(1)> javascript:alert(1) a@b.c &#39;');
		expect(parts).toEqual([
			{ kind: 'text', text: '<img src=x onerror=alert(1)> javascript:alert(1) a@b.c &#39;' }
		]);
		expect(linkify(null)).toEqual([]);
	});
});
