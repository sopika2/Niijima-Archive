import { collectionOptions, findCollectionByName, getCollection } from './db/collections.ts';
import { owners, type Owner } from './db/schema.ts';
import { bearerAllowed } from './guard.ts';
import { MediaRejected } from './media/store.ts';
import { saveTweet, saveUpload, type SaveServices } from './save.ts';
import { findTweetUrl, findUrl } from './tweet/url.ts';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			...headers
		}
	});

interface Fields {
	readonly get: (name: string) => string;
	readonly files: File[];
}

async function readFields(request: Request): Promise<Fields | null> {
	const type = request.headers.get('content-type') ?? '';
	if (type.includes('application/json')) {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		if (!body || typeof body !== 'object') return null;
		return {
			get: (name) => (typeof body[name] === 'string' ? (body[name] as string) : ''),
			files: []
		};
	}
	if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
		const form = await request.formData().catch(() => null);
		if (!form) return null;
		const files = [...form.values()].filter(
			(value): value is File => value instanceof File && value.size > 0
		);
		return { get: (name) => String(form.get(name) ?? '').trim(), files };
	}
	return null;
}

/**
 * POST /api/save, for the iPhone (an iOS Shortcut in the share sheet) and anything else that
 * can't use the Android share target. Needs `Authorization: Bearer <SAVE_TOKEN>`; the sign-in
 * cookie is ignored. Fields: `url` and/or files, plus optional `caption`, `collection` (name or
 * id), `tags` and `owner` (makoto, sae or shared; defaults to the collection's owner).
 */
export async function handleSave(
	request: Request,
	deps: { services: SaveServices; token: string | null; origin: string }
): Promise<Response> {
	if (!deps.token)
		return json(404, { error: 'Saving by token is off. Set SAVE_TOKEN in .env to turn it on.' });
	if (!bearerAllowed(request.headers.get('authorization'), deps.token))
		return json(
			401,
			{ error: 'Missing or wrong token.' },
			{ 'www-authenticate': 'Bearer realm="archive"' }
		);

	const fields = await readFields(request);
	if (!fields) return json(400, { error: 'Send multipart/form-data, a form, or JSON.' });
	const { db } = deps.services;

	const wanted = fields.get('collection');
	const collection = wanted
		? (getCollection(db, wanted) ?? findCollectionByName(db, wanted))
		: null;
	if (wanted && !collection) {
		const names = collectionOptions(db).map((option) => option.name);
		return json(400, { error: `No collection called "${wanted}".`, collections: names });
	}
	const ownerField = fields.get('owner').toLowerCase();
	if (ownerField && !owners.includes(ownerField as Owner))
		return json(400, { error: 'owner must be makoto, sae or shared.' });
	const owner = (ownerField as Owner) || collection?.owner || 'shared';
	const placement = {
		owner,
		collectionId: collection?.id ?? null,
		tags: fields.get('tags')
	};
	const caption = fields.get('caption').slice(0, 5000);
	const text = fields.get('url') || fields.get('text');
	const link = (id: string) => `${deps.origin}/?item=${id}`;

	if (fields.files.length > 0) {
		const saved: Array<{ id: string; url: string }> = [];
		const errors: string[] = [];
		for (const file of fields.files) {
			try {
				const id = await saveUpload(
					deps.services,
					{ bytes: Buffer.from(await file.arrayBuffer()), caption, sourceUrl: findUrl(text) },
					placement
				);
				saved.push({ id, url: link(id) });
			} catch (error) {
				if (!(error instanceof MediaRejected)) throw error;
				errors.push(`${file.name || 'file'}: ${error.message}`);
			}
		}
		if (saved.length === 0) return json(415, { error: 'Nothing could be saved.', errors });
		return json(201, { ok: true, items: saved, errors });
	}

	const ref = findTweetUrl(text);
	if (!ref)
		return json(400, {
			error: 'Send a tweet link (x.com or twitter.com) in "url", or attach files.'
		});
	const result = await saveTweet(deps.services, ref, { ...placement, caption }, null);
	return json(result.duplicate ? 200 : 201, {
		ok: true,
		items: [{ id: result.id, url: link(result.id) }],
		duplicate: result.duplicate,
		fetched: result.fetched,
		error: result.error
	});
}
