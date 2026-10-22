import type { Zipline } from '../zipline.ts';

const PASSED = ['content-length', 'content-range', 'accept-ranges', 'last-modified'] as const;

/**
 * Streams a file from Zipline through the Archive, byte ranges and all, so videos seek and
 * Safari plays them. The browser only ever talks to the Archive: the Zipline token stays on
 * the server, password-protected files work, and the traffic between the two stays inside
 * Docker. Null when Zipline doesn't have the file.
 */
export async function proxyZipline(
	zipline: Zipline,
	file: { ziplineId: string; ziplineName: string | null; mime: string | null },
	request: Request,
	headers: { cacheControl: string; download?: string }
): Promise<Response | null> {
	const etag = `"z-${file.ziplineId}"`;
	const base: Record<string, string> = {
		'cache-control': headers.cacheControl,
		etag,
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
	};
	if (headers.download) base['content-disposition'] = `attachment; filename="${headers.download}"`;
	if (request.headers.get('if-none-match') === etag)
		return new Response(null, { status: 304, headers: base });

	const upstream = await zipline.raw(
		{ id: file.ziplineId, name: file.ziplineName },
		{ range: request.headers.get('range'), signal: request.signal }
	);
	if (upstream.status === 404) {
		await upstream.body?.cancel();
		return null;
	}
	if (upstream.status !== 200 && upstream.status !== 206 && upstream.status !== 416) {
		await upstream.body?.cancel();
		return new Response(`Mementos answered ${upstream.status}.`, {
			status: 502,
			headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
		});
	}
	const out: Record<string, string> = {
		...base,
		'content-type': file.mime ?? upstream.headers.get('content-type') ?? 'application/octet-stream'
	};
	for (const name of PASSED) {
		const value = upstream.headers.get(name);
		if (value) out[name] = value;
	}
	out['accept-ranges'] = 'bytes';
	if (request.method === 'HEAD') {
		await upstream.body?.cancel();
		return new Response(null, { status: upstream.status, headers: out });
	}
	return new Response(upstream.status === 416 ? null : upstream.body, {
		status: upstream.status,
		headers: out
	});
}
