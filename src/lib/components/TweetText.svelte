<script lang="ts">
	/** Tweet text as text, with links, mentions and hashtags as real links. Never {@html}. */
	import { linkify } from '$lib/linkify.ts';

	let { text, class: className = '' }: { text: string | null; class?: string } = $props();
	const parts = $derived(linkify(text));
</script>

<p class="tweet-text {className}">
	{#each parts as part, i (i)}{#if part.kind === 'link'}<a
				href={part.href}
				target="_blank"
				rel="noopener noreferrer nofollow">{part.text}</a
			>{:else}{part.text}{/if}{/each}
</p>

<style>
	.tweet-text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	a {
		color: inherit;
		font-weight: 700;
		text-decoration: underline;
		text-decoration-color: var(--nj-accent);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}
</style>
