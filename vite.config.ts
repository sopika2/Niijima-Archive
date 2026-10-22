import { readFileSync } from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ command }) => ({
	define: {
		__ARCHIVE_VERSION__: JSON.stringify(version)
	},
	plugins: [sveltekit()],
	server: { port: 5183, strictPort: true },
	// For the production build, bundle every dependency into the server so the container only
	// needs node_modules for the two native modules. In development Vite loads them normally.
	ssr: command === 'build' ? { noExternal: true, external: ['better-sqlite3', 'sharp'] } : {},
	test: {
		expect: { requireAssertions: true },
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
}));
