import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from src/lib/server/db/schema.ts:  pnpm db:generate
// Migrations are checked into git and applied automatically when the app starts.
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './migrations',
	dialect: 'sqlite',
	strict: true,
	verbose: true
});
