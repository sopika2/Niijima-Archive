declare global {
	namespace App {
		interface Locals {
			/** Who is signed in with Discord (null when ACCESS_MODE=off). */
			user: { id: string; name: string } | null;
			/** Makoto or Sae, from the cookie every Niijima site shares (Makoto when none is set). */
			persona: import('@niijima/design').Persona;
		}
		interface PageState {
			/** The item open in the lightbox, so Back closes it. */
			item?: string;
		}
	}
}

export {};
