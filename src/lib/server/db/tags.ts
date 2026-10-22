/**
 * Tags as she types them: "makoto, #bike  fanart" becomes ["makoto", "bike", "fanart"].
 * Lowercase words of letters, digits, "-" and "_", at most 32 characters, at most 20 per item.
 */
export function normaliseTags(input: string | readonly string[] | null | undefined): string[] {
	const text = Array.isArray(input)
		? input.join(',')
		: ((input as string | null | undefined) ?? '');
	const tags = text
		.normalize('NFKC')
		.toLowerCase()
		.split(/[\s,#]+/)
		.map((tag) => tag.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 32))
		.filter(Boolean);
	return [...new Set(tags)].slice(0, 20);
}
