/** Dates and lengths the way the Den writes them. */
export function formatDate(
	iso: string | null | undefined,
	locale = 'en-GB',
	timeZone?: string,
	withTime = false
): string {
	if (!iso) return '';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleString(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
		timeZone
	});
}

export function formatDuration(ms: number | null | undefined): string {
	if (!ms || ms <= 0) return '';
	const seconds = Math.round(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The width-to-height ratio a tile is laid out with: real when known, kept within reason. */
export function tileRatio(
	width: number | null | undefined,
	height: number | null | undefined,
	fallback = 1
): number {
	if (!width || !height) return fallback;
	return Math.min(2.2, Math.max(0.5, width / height));
}
