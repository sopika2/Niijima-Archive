/**
 * Turns what she typed into an FTS5 query. Every word has to appear somewhere in the item
 * (caption, tweet text, author, tags, quoted tweet), and each may be the start of a longer word,
 * so the gallery narrows down while she types. Only letters, digits and underscores survive:
 * quotes, stars, brackets and words like OR or NOT are plain text, never FTS5 syntax.
 */
export function ftsQuery(input: string | null | undefined): string | null {
	const words =
		(input ?? '')
			.normalize('NFKC')
			.toLowerCase()
			.match(/[\p{L}\p{N}_]+/gu) ?? [];
	const unique = [...new Set(words)].slice(0, 12);
	if (unique.length === 0) return null;
	return unique.map((word) => `"${word}"*`).join(' ');
}
