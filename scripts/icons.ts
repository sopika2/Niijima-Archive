// Renders the PWA icons from static/icons/icon.svg:  pnpm icons
// The PNGs are committed; run this again only after changing the SVG.
import sharp from 'sharp';

const dir = new URL('../static/icons/', import.meta.url);
const svg = new URL('icon.svg', dir).pathname;

for (const size of [192, 512]) {
	await sharp(svg, { density: 300 })
		.resize(size, size)
		.png()
		.toFile(new URL(`icon-${size}.png`, dir).pathname);
}
await sharp(svg, { density: 300 })
	.resize(180, 180)
	.png()
	.toFile(new URL('apple-touch-icon.png', dir).pathname);

// Maskable: the artwork inside the 80% safe zone on a full ink square.
const inner = await sharp(svg, { density: 300 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b0b0d' } })
	.composite([{ input: inner, top: 51, left: 51 }])
	.png()
	.toFile(new URL('icon-maskable-512.png', dir).pathname);
console.log('icons written');
