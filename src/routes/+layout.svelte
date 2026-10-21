<script lang="ts">
	import '@niijima/design/niijima.css';
	import '../app.css';
	import { Loader } from '@niijima/design/svelte';
	import { navigating } from '$app/state';
	import { onMount } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	/* "Take your time" only when a page is slow to arrive, never as a flash on a quick one. */
	let slow = $state(false);
	$effect(() => {
		if (!navigating.to) {
			slow = false;
			return;
		}
		const timer = setTimeout(() => (slow = true), 350);
		return () => clearTimeout(timer);
	});

	onMount(() => {
		// Only so Android offers to install the Archive (and its share target); it caches nothing.
		if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
	});
</script>

{@render children()}

{#if slow}<Loader />{/if}
