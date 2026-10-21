import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import type { FetchLike } from './safe-fetch.ts';

/**
 * Mementos (the owner's Zipline at mementos.niijimasisters.com): uploads a saved file there and
 * hands back its share link. Only on demand ("Copy Mementos link"), so saving never waits on it.
 */
export interface Zipline {
	readonly url: string;
	readonly token: string;
	readonly fetchImpl?: FetchLike;
	readonly timeoutMs?: number;
}

/** The link in Zipline's answer: v3 sends { files: ["url"] }, v4 { files: [{ url }] }. */
export function linkFromResponse(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null;
	const files = (body as { files?: unknown }).files;
	const first = Array.isArray(files) ? files[0] : undefined;
	const link = typeof first === 'string' ? first : (first as { url?: unknown } | undefined)?.url;
	if (typeof link !== 'string') return null;
	try {
		const url = new URL(link);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
	} catch {
		return null;
	}
}

export async function uploadToZipline(
	zipline: Zipline,
	file: { path: string; mime: string; name?: string }
): Promise<string> {
	const form = new FormData();
	const blob = await openAsBlob(file.path, { type: file.mime });
	form.append('file', blob, file.name ?? basename(file.path));
	const response = await (zipline.fetchImpl ?? fetch)(
		`${zipline.url.replace(/\/+$/, '')}/api/upload`,
		{
			method: 'POST',
			headers: { authorization: zipline.token },
			body: form,
			signal: AbortSignal.timeout(zipline.timeoutMs ?? 120_000)
		}
	);
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		const message =
			(body as { error?: unknown; message?: unknown } | null)?.error ??
			(body as { message?: unknown } | null)?.message;
		throw new Error(
			`Mementos refused the upload (${response.status}${typeof message === 'string' ? `: ${message}` : ''}).`
		);
	}
	const link = linkFromResponse(body);
	if (!link) throw new Error('Mementos answered without a link.');
	return link;
}
