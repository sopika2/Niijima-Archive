import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A short random id (20 characters, about 103 bits) in lowercase letters and digits only, so it
 * is safe in URLs and as a file name on any disk, including case-insensitive ones.
 */
export function newId(length = 20): string {
	const bytes = randomBytes(length);
	let out = '';
	for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
	return out;
}

export const ID_PATTERN = /^[a-z0-9]{8,32}$/;
