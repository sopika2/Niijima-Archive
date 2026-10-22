/**
 * What a file really is, from its first bytes, never from its name or the type the browser
 * claims. Only pictures, GIFs and short videos the browser can show are accepted.
 */
export type SniffedKind = 'image' | 'gif' | 'video';

export interface Sniffed {
	readonly mime: string;
	readonly ext: string;
	readonly kind: SniffedKind;
}

const ascii = (bytes: Uint8Array, start: number, end: number) =>
	String.fromCharCode(...bytes.subarray(start, end));

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
	bytes.length >= offset + signature.length &&
	signature.every((byte, i) => bytes[offset + i] === byte);

/** The ISO base media brands we keep, by what they are. */
const AVIF_BRANDS = new Set(['avif', 'avis']);
const MP4_BRANDS = new Set([
	'isom',
	'iso2',
	'iso4',
	'iso5',
	'iso6',
	'mp41',
	'mp42',
	'avc1',
	'dash',
	'M4V ',
	'MSNV',
	'mmp4'
]);

export function sniff(bytes: Uint8Array): Sniffed | null {
	if (startsWith(bytes, [0xff, 0xd8, 0xff]))
		return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return { mime: 'image/png', ext: 'png', kind: 'image' };
	if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a'))
		return { mime: 'image/gif', ext: 'gif', kind: 'gif' };
	if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP')
		return { mime: 'image/webp', ext: 'webp', kind: 'image' };
	if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
		const brand = ascii(bytes, 8, 12);
		if (AVIF_BRANDS.has(brand)) return { mime: 'image/avif', ext: 'avif', kind: 'image' };
		if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov', kind: 'video' };
		if (MP4_BRANDS.has(brand)) return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
		return null;
	}
	if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
		// Matroska; only its WebM flavour plays in browsers.
		const head = ascii(bytes, 0, Math.min(bytes.length, 64));
		return head.includes('webm') ? { mime: 'video/webm', ext: 'webm', kind: 'video' } : null;
	}
	return null;
}

/** Content types by stored extension, for serving files back. */
export const MIME_BY_EXT: Readonly<Record<string, string>> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm'
};

/** Extensions by content type, for naming files that only Zipline has. */
export const EXT_BY_MIME: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext])
);
