<script lang="ts">
	/** Every error as the 404 Palace: the status in cut-out tiles, the address on a Target plate. */
	import { Palace } from '@niijima/design/svelte';
	import { page } from '$app/state';

	const NOT_FOUND =
		'No distortion here. Nothing to steal.\nWhatever you were looking for was never taken into the Den.';
	const missing = $derived(page.status === 404);
	const signin = $derived(page.status === 401);
</script>

<svelte:head>
	<title>{page.status} · Thieves Den</title>
</svelte:head>

{#if missing}
	<Palace
		code="404"
		target={page.url.pathname}
		text={NOT_FOUND}
		back={{ label: 'Back to the Den', href: '/' }}
	/>
{:else if signin}
	<Palace
		code="401"
		title="Show your calling card"
		target={page.url.pathname}
		text="Sign in first."
		back={{ label: 'Sign in', href: '/signin' }}
	/>
{:else}
	<Palace
		code={String(page.status)}
		title="The heist went sideways"
		target={page.url.pathname}
		text={page.error?.message && page.status < 500
			? page.error.message
			: 'Something broke on our side. Try again in a moment.'}
		back={{ label: 'Back to the Den', href: '/' }}
	/>
{/if}
