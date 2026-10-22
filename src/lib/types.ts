/** Shapes the server sends to pages. No server imports here: the browser uses these too. */
export type Owner = 'makoto' | 'sae' | 'shared';
export type Persona = 'makoto' | 'sae';
export type ItemKind = 'tweet' | 'image';
export type MediaKind = 'image' | 'gif' | 'video';

export const OWNER_LABELS: Record<Owner, string> = {
	makoto: 'Makoto',
	sae: 'Sae',
	shared: 'Shared'
};

export interface MediaView {
	readonly id: string;
	readonly kind: MediaKind;
	/** The stored file, or null when its download failed (or Mementos lost it). */
	readonly url: string | null;
	/** A still WebP for the grid, or null (a video without a poster). */
	readonly thumb: string | null;
	readonly mime: string | null;
	readonly width: number | null;
	readonly height: number | null;
	readonly durationMs: number | null;
	readonly alt: string | null;
	/** The public Mementos (Zipline) link, to share. */
	readonly mirrorUrl: string | null;
	/** Its file was deleted on Mementos. */
	readonly gone: boolean;
}

export interface TweetView {
	readonly id: string;
	readonly url: string;
	readonly text: string | null;
	readonly authorName: string | null;
	readonly authorHandle: string | null;
	readonly postedAt: string | null;
	readonly quote: {
		readonly url: string;
		readonly text: string;
		readonly authorName: string;
		readonly authorHandle: string;
	} | null;
}

export interface ItemView {
	readonly id: string;
	readonly kind: ItemKind;
	readonly owner: Owner;
	readonly caption: string;
	readonly tags: readonly string[];
	readonly sourceUrl: string | null;
	readonly collection: { readonly id: string; readonly name: string } | null;
	readonly tweet: TweetView | null;
	readonly fetchState: 'none' | 'ok' | 'failed';
	readonly fetchError: string | null;
	readonly media: readonly MediaView[];
	readonly createdAt: string;
	/** A tweet whose fetch failed or whose files didn't all download. */
	readonly needsRetry: boolean;
}

export interface CollectionView {
	readonly id: string;
	readonly name: string;
	readonly owner: Owner;
	readonly count: number;
	readonly coverItemId: string | null;
	readonly cover: {
		readonly thumb: string;
		readonly width: number | null;
		readonly height: number | null;
	} | null;
}

export interface CollectionOption {
	readonly id: string;
	readonly name: string;
	readonly owner: Owner;
}
