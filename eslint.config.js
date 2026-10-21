import prettier from 'eslint-config-prettier';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default defineConfig(
	{ ignores: ['**/node_modules/**', 'build/**', '.svelte-kit/**', 'migrations/**', 'data/**'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			'no-undef': 'off',
			// The app is always served at the root of its own subdomain, so plain paths are correct.
			'svelte/no-navigation-without-resolve': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	{
		// Fetched tweet text is never trusted markup: it is rendered as text, split into links by
		// $lib/linkify.ts. Nothing in this app needs {@html}.
		files: ['**/*.svelte'],
		rules: { 'svelte/no-at-html-tags': 'error' }
	},
	{
		files: ['src/**/*.ts', 'src/**/*.svelte'],
		ignores: [
			'src/lib/server/**',
			'src/routes/**/+server.ts',
			'src/routes/**/*.server.ts',
			'src/hooks.server.ts'
		],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: [
								'$lib/server/*',
								'node:*',
								'better-sqlite3',
								'sharp',
								'drizzle-orm',
								'drizzle-orm/*'
							],
							message: 'Browser code cannot import server modules.'
						}
					]
				}
			]
		}
	}
);
