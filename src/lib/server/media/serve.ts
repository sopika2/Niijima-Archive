import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

/**
 * Sends a file from disk with byte ranges (Safari won't play a video without them), an ETag
 * and the given Cache-Control. Null when the file isn't there.
 */
export async function serveFile(
	path: string,
	request: Request,
	headers: { contentType: string; cacheControl: string; download?: string }
): Promise<Response | null> {
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) return null;
	const etag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
	const base: Record<string, string> = {
		'content-type': headers.contentType,
		'cache-control': headers.cacheControl,
		'accept-ranges': 'bytes',
		etag,
		'last-modified': info.mtime.toUTCString(),
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
	};
	if (headers.download) base['content-disposition'] = `attachment; filename="${headers.download}"`;
	if (request.headers.get('if-none-match') === etag)
		return new Response(null, { status: 304, headers: base });

	const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
	if (range && (range[1] || range[2])) {
		let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
		let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
		start = Math.max(0, start);
		end = Math.min(end, info.size - 1);
		if (start > end || start >= info.size) {
			return new Response(null, {
				status: 416,
				headers: { ...base, 'content-range': `bytes */${info.size}` }
			});
		}
		const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
		return new Response(stream, {
			status: 206,
			headers: {
				...base,
				'content-range': `bytes ${start}-${end}/${info.size}`,
				'content-length': String(end - start + 1)
			}
		});
	}
	if (request.method === 'HEAD')
		return new Response(null, { headers: { ...base, 'content-length': String(info.size) } });
	const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
	return new Response(stream, { headers: { ...base, 'content-length': String(info.size) } });
}
