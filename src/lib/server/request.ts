import { getCollection } from './db/collections.ts';
import type { Db } from './db/client.ts';
import { owners, type Owner } from './db/schema.ts';
import { scopeFor, type Scope } from './db/scope.ts';

/** The persona's view: her things and the shared ones. */
export function scopeOf(locals: App.Locals): Scope {
	return scopeFor(locals.persona);
}

export function readOwner(value: FormDataEntryValue | null, fallback: Owner): Owner {
	return typeof value === 'string' && owners.includes(value as Owner) ? (value as Owner) : fallback;
}

/** A collection id from a form, if the scope can see it; "" means none (unsorted). */
export function readCollection(
	db: Db,
	value: FormDataEntryValue | null,
	scope: Scope
): string | null {
	if (typeof value !== 'string' || value === '') return null;
	return getCollection(db, value, scope)?.id ?? null;
}

export const text = (form: FormData, name: string, max = 5000) =>
	String(form.get(name) ?? '')
		.trim()
		.slice(0, max);
