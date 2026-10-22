/**
 * A fake Zipline v4 on http://localhost:3999 for trying the Archive's Mementos storage by hand,
 * with two pictures already "uploaded from the phone" for the sync to find:
 *
 *   node scripts/fake-zipline.ts
 *   ZIPLINE_URL=http://localhost:3999 ZIPLINE_INTERNAL_URL=http://localhost:3999 \
 *     ZIPLINE_TOKEN=fake-token pnpm dev
 */
import sharp from 'sharp';
import { FakeZipline } from '../tests/fake-zipline.ts';

const port = Number(process.env.PORT ?? 3999);
const zipline = new FakeZipline();
const picture = (colour: string, width: number, height: number) =>
	sharp({ create: { width, height, channels: 3, background: colour } })
		.jpeg()
		.toBuffer();
zipline.addDirect('phone-shot.jpg', await picture('#d90416', 900, 1200), 'image/jpeg');
zipline.addDirect('sharex-capture.jpg', await picture('#3fd8ff', 1280, 720), 'image/jpeg');
zipline.addDirect('notes.txt', Buffer.from('not a picture'), 'text/plain');

const { url } = await zipline.listen(port);
console.log(`fake Zipline v4 on ${url} (token: ${zipline.token})`);
