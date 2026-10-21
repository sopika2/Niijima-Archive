import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		// PUBLIC_URL is a server setting shared with the other Niijima apps, not a browser one, so
		// nothing here uses SvelteKit's PUBLIC_ prefix for values sent to the browser.
		env: { publicPrefix: 'BROWSER_' },
		// The hooks run their own origin check: SvelteKit's would also refuse Android's share
		// sheet, which posts to /share without an Origin header (see src/hooks.server.ts).
		csrf: { trustedOrigins: ['*'] },
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'media-src': ['self', 'blob:'],
				'font-src': ['self'],
				'connect-src': ['self'],
				'worker-src': ['self'],
				'manifest-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
