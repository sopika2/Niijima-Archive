/** Plain, timestamped log lines; `docker compose logs` shows them as-is. */
export function log(scope: string, message: string): void {
	console.log(`${new Date().toISOString()} [${scope}] ${message}`);
}

export function logError(scope: string, error: unknown): void {
	const text = error instanceof Error ? error.message : String(error);
	console.error(`${new Date().toISOString()} [${scope}] ${text}`);
}
