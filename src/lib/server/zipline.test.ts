import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { linkFromResponse, uploadToZipline } from './zipline.ts';

const dir = mkdtempSync(join(tmpdir(), 'archive-zipline-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Mementos (Zipline)', () => {
	it('reads the link from both Zipline versions', () => {
		expect(linkFromResponse({ files: ['https://mementos.niijimasisters.com/u/a.png'] })).toBe(
			'https://mementos.niijimasisters.com/u/a.png'
		);
		expect(
			linkFromResponse({
				files: [{ id: 'x', type: 'image/png', url: 'https://mementos.niijimasisters.com/u/b.png' }]
			})
		).toBe('https://mementos.niijimasisters.com/u/b.png');
		expect(linkFromResponse({ files: [] })).toBeNull();
		expect(linkFromResponse({ files: ['javascript:alert(1)'] })).toBeNull();
		expect(linkFromResponse(null)).toBeNull();
	});

	it('posts the file as "file" with the token as is', async () => {
		const path = join(dir, 'abc.png');
		writeFileSync(path, 'png bytes');
		let seen: { url: string; auth: string | null; name: string | undefined } | null = null;
		const link = await uploadToZipline(
			{
				url: 'https://mementos.niijimasisters.com/',
				token: 'zip-token',
				fetchImpl: async (url, init) => {
					const form = init!.body as FormData;
					seen = {
						url,
						auth: new Headers(init!.headers).get('authorization'),
						name: (form.get('file') as File | null)?.name
					};
					return Response.json({
						files: [{ url: 'https://mementos.niijimasisters.com/u/abc.png' }]
					});
				}
			},
			{ path, mime: 'image/png' }
		);
		expect(link).toBe('https://mementos.niijimasisters.com/u/abc.png');
		expect(seen).toEqual({
			url: 'https://mementos.niijimasisters.com/api/upload',
			auth: 'zip-token',
			name: 'abc.png'
		});
	});

	it('says when Zipline refuses', async () => {
		const path = join(dir, 'x.png');
		writeFileSync(path, 'x');
		await expect(
			uploadToZipline(
				{
					url: 'https://m.example',
					token: 't',
					fetchImpl: async () => Response.json({ error: 'no' }, { status: 401 })
				},
				{ path, mime: 'image/png' }
			)
		).rejects.toThrow(/401: no/);
	});
});
