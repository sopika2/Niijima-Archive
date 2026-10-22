import { parse as parseYaml, YAMLParseError } from 'yaml';
import { z } from 'zod';

/** config.yml: how the Archive behaves. Every setting has a default; typos stop the start. */
export const configSchema = z.strictObject({
	/** Dates on the page, e.g. en-GB. */
	locale: z.string().min(2).default('en-GB'),
	timezone: z
		.string()
		.refine(
			(zone) => {
				try {
					new Intl.DateTimeFormat('en', { timeZone: zone });
					return true;
				} catch {
					return false;
				}
			},
			{ message: 'must be an IANA time zone such as Europe/Budapest' }
		)
		.default('Europe/Budapest'),
	/** Who greets you in the Den. `art` is a file in the mounted assets folder. */
	host: z
		.strictObject({
			name: z.string().min(1).max(40).default('Makoto'),
			art: z
				.string()
				.regex(/^\/assets\/[\w./-]+\.(png|webp|avif|jpe?g|gif)$/i, {
					message: 'must be a picture under /assets/, e.g. /assets/makoto.webp'
				})
				.refine((path) => !path.includes('..'), { message: 'must not contain ".."' })
				.default('/assets/host.webp'),
			lines: z
				.array(z.string().min(1).max(240))
				.min(1)
				.default([
					"Everything we've taken, catalogued. Write down why you took it. Future you will ask.",
					'A treasure without a caption is just clutter. Give it a reason to be here.',
					"Paste a link, drop a picture. I'll keep it safe, even if the original disappears."
				])
		})
		.prefault({}),
	access: z
		.strictObject({
			/** Discord accounts allowed to sign in, by user id. */
			discord_user_ids: z
				.array(
					z
						.unknown()
						.transform((value, ctx) => {
							if (typeof value !== 'number') return value;
							if (Number.isSafeInteger(value)) return String(value);
							ctx.addIssue({
								code: 'custom',
								message: "put Discord ids in quotes: '123456789012345678'"
							});
							return z.NEVER;
						})
						.pipe(
							z
								.string()
								.regex(/^\d{15,21}$/, { message: 'must be a Discord user id (digits only)' })
						)
				)
				.default([])
		})
		.prefault({}),
	media: z
		.strictObject({
			/** Largest file you can upload or share in, in MB. */
			max_upload_mb: z.number().positive().max(2048).default(100),
			/** Largest single photo or video downloaded from a tweet, in MB. */
			max_tweet_media_mb: z.number().positive().max(2048).default(100),
			/** How long to wait for FxTwitter, vxTwitter and the media hosts, in seconds. */
			fetch_timeout_seconds: z.number().int().min(2).max(300).default(20),
			/** Width of the grid thumbnails, in pixels. */
			thumb_width: z.number().int().min(160).max(1600).default(480)
		})
		.prefault({}),
	gallery: z
		.strictObject({
			/** Items loaded at a time while scrolling. */
			page_size: z.number().int().min(10).max(200).default(40)
		})
		.prefault({})
});

export type Config = z.output<typeof configSchema>;

export function defaultConfig(): Config {
	return configSchema.parse({});
}

export class ConfigError extends Error {
	override readonly name = 'ConfigError';
}

/** Parses config.yml text. Errors name the setting and say what was expected. */
export function parseConfig(text: string, file = 'config.yml'): Config {
	let data: unknown;
	try {
		data = parseYaml(text) ?? {};
	} catch (error) {
		const where =
			error instanceof YAMLParseError && error.linePos ? ` (line ${error.linePos[0].line})` : '';
		throw new ConfigError(
			`${file} is not valid YAML${where}: ${(error as Error).message.split('\n')[0]}`
		);
	}
	const result = configSchema.safeParse(data);
	if (!result.success) {
		const problems = result.error.issues
			.map((issue) => `  ${issue.path.join('.') || '(top)'}: ${issue.message}`)
			.join('\n');
		throw new ConfigError(`${file} has problems:\n${problems}`);
	}
	return result.data;
}
