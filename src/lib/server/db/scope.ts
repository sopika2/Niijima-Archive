import { inArray, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Owner } from './schema.ts';

/**
 * What one persona sees: her own things and the shared ones. Functions that take a scope leave
 * out everything else; without one they see everything (the /api/save endpoint, clean-ups).
 */
export interface Scope {
	readonly owners: readonly Owner[];
}

/** Makoto's or Sae's view: hers and the shared ones. */
export function scopeFor(persona: 'makoto' | 'sae'): Scope {
	return { owners: [persona, 'shared'] };
}

/** `column IN (owners)`, or nothing without a scope. */
export function ownedBy(column: SQLiteColumn, scope?: Scope | null): SQL | undefined {
	return scope ? inArray(column, [...scope.owners]) : undefined;
}

/** Whether a row with this owner is visible in the scope. */
export function inScope(owner: Owner, scope?: Scope | null): boolean {
	return !scope || scope.owners.includes(owner);
}
