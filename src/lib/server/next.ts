/**
 * Where to go after signing in. Only paths on this site are accepted, so a crafted link can't
 * send you to another website after you sign in.
 */
export function safeNext(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
		return '/';
	}
	if (value.startsWith('/signin') || value.startsWith('/auth/')) return '/';
	return value;
}
