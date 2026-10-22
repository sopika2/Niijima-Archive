import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, defaultConfig, parseConfig } from './config.ts';

describe('config.yml', () => {
	it('has a default for everything', () => {
		const config = defaultConfig();
		expect(config.host.name).toBe('Makoto');
		expect(config.media.max_upload_mb).toBe(100);
		expect(parseConfig('')).toEqual(config);
	});

	it('accepts the example file as shipped', () => {
		const text = readFileSync(new URL('../../../config.example.yml', import.meta.url), 'utf8');
		expect(parseConfig(text).host.lines.length).toBeGreaterThan(0);
	});

	it('names the setting that is wrong', () => {
		expect(() => parseConfig('media:\n  max_upload_mb: -1')).toThrow(/media\.max_upload_mb/);
		expect(() => parseConfig('hots: {}')).toThrow(ConfigError);
		expect(() => parseConfig('host:\n  art: /etc/passwd')).toThrow(/host\.art/);
		expect(() => parseConfig('access:\n  discord_user_ids: [abc]')).toThrow(/Discord user id/);
		expect(() => parseConfig('a: [')).toThrow(/not valid YAML/);
	});

	it('asks for quotes around Discord ids too long for a YAML number', () => {
		expect(() => parseConfig('access:\n  discord_user_ids: [123456789012345678]')).toThrow(
			/quotes/
		);
		expect(
			parseConfig("access:\n  discord_user_ids: ['123456789012345678']").access.discord_user_ids
		).toEqual(['123456789012345678']);
	});
});
