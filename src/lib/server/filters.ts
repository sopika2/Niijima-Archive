import type { ItemFilter } from './db/items.ts';

/** The gallery's filters as they appear in the address: ?q=&type=&c=&tag= */
export function filterFromUrl(url: URL): Omit<ItemFilter, 'scope'> {
	const type = url.searchParams.get('type');
	const c = url.searchParams.get('c');
	return {
		q: url.searchParams.get('q')?.slice(0, 200) || null,
		kind: type === 'tweet' || type === 'image' ? type : null,
		collectionId: c && /^[a-z0-9]{8,32}$|^none$/.test(c) ? c : null,
		tag: url.searchParams.get('tag')?.toLowerCase().slice(0, 32) || null
	};
}
