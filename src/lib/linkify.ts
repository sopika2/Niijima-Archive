/**
 * Tweet text, split into plain text and links, so pages can render it with ordinary {text}
 * and <a> elements. Fetched text is never treated as markup: there is no {@html} anywhere.
 */
export type Segment =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'link'; readonly text: string; readonly href: string };

const PATTERN =
	/(https?:\/\/[^\s<>"'\u3000]+)|(^|[^\w@])@(\w{1,15})|(^|[^\w#&])#([\p{L}\p{N}_]{1,100})/gu;

export function linkify(input: string | null | undefined): Segment[] {
	const text = input ?? '';
	const out: Segment[] = [];
	let last = 0;
	const push = (piece: string) => {
		if (!piece) return;
		const prev = out[out.length - 1];
		if (prev?.kind === 'text') out[out.length - 1] = { kind: 'text', text: prev.text + piece };
		else out.push({ kind: 'text', text: piece });
	};
	for (const match of text.matchAll(PATTERN)) {
		const start = match.index;
		push(text.slice(last, start));
		if (match[1]) {
			// Trailing punctuation belongs to the sentence, not the link.
			const url = match[1].replace(/[.,;:!?)\]]+$/, '');
			out.push({ kind: 'link', text: url.replace(/^https?:\/\//, ''), href: url });
			push(match[1].slice(url.length));
		} else if (match[3]) {
			push(match[2] ?? '');
			out.push({ kind: 'link', text: `@${match[3]}`, href: `https://x.com/${match[3]}` });
		} else if (match[5]) {
			push(match[4] ?? '');
			out.push({
				kind: 'link',
				text: `#${match[5]}`,
				href: `https://x.com/hashtag/${encodeURIComponent(match[5])}`
			});
		}
		last = start + match[0].length;
	}
	push(text.slice(last));
	return out;
}
