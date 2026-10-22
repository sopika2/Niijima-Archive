/**
 * The only way this app reaches the internet for content: https only, to a fixed list of
 * hosts (checked again on every redirect), with a timeout and a cap on how much is read.
 * Anything else is refused before a connection is made.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class FetchRefused extends Error {
	override readonly name = 'FetchRefused';
}

export interface SafeFetchOptions {
	readonly allowedHosts: ReadonlySet<string>;
	readonly timeoutMs: number;
	readonly maxBytes: number;
	readonly fetchImpl?: FetchLike;
	readonly accept?: string;
	readonly maxRedirects?: number;
}

export interface SafeResponse {
	readonly status: number;
	readonly url: string;
	readonly contentType: string | null;
	readonly body: Buffer;
}

export function checkUrl(raw: string, allowedHosts: ReadonlySet<string>): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new FetchRefused(`Not a web address: ${raw.slice(0, 80)}`);
	}
	if (url.protocol !== 'https:') throw new FetchRefused(`Only https is fetched (${url.protocol}).`);
	if (url.username || url.password)
		throw new FetchRefused('Addresses with a login are not fetched.');
	if (!allowedHosts.has(url.hostname))
		throw new FetchRefused(`${url.hostname} is not on the list of allowed hosts.`);
	return url;
}

export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<SafeResponse> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const signal = AbortSignal.timeout(options.timeoutMs);
	let url = checkUrl(raw, options.allowedHosts);
	let response: Response | null = null;
	for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop++) {
		response = await fetchImpl(url.toString(), {
			redirect: 'manual',
			signal,
			headers: {
				accept: options.accept ?? '*/*',
				'user-agent': 'NiijimaArchive/1.0 (+https://github.com/sopika2/Niijima-Archive)'
			}
		});
		const location = response.headers.get('location');
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel().catch(() => {});
			url = checkUrl(new URL(location, url).toString(), options.allowedHosts);
			continue;
		}
		break;
	}
	if (!response || (response.status >= 300 && response.status < 400))
		throw new FetchRefused('Too many redirects.');

	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > options.maxBytes) {
		await response.body?.cancel().catch(() => {});
		throw new FetchRefused(`The file is too big (${Math.round(declared / 1e6)} MB).`);
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	if (response.body) {
		const reader = response.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > options.maxBytes) {
				await reader.cancel().catch(() => {});
				throw new FetchRefused(
					`The file is too big (over ${Math.round(options.maxBytes / 1e6)} MB).`
				);
			}
			chunks.push(value);
		}
	}
	return {
		status: response.status,
		url: url.toString(),
		contentType: response.headers.get('content-type'),
		body: Buffer.concat(chunks)
	};
}

/** A readable reason for a failed fetch, for logs and the "retry" notice. */
export function describeFetchError(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'Timed out.';
		const cause = (error as { cause?: { code?: string } }).cause?.code;
		return cause ? `${error.message} (${cause})` : error.message;
	}
	return String(error);
}
