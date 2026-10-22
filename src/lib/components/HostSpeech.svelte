<script lang="ts">
	/** The host greeting you: her picture and a line in a speech box. */
	import { Speech } from '@niijima/design/svelte';
	import type { Snippet } from 'svelte';
	import HostArt from './HostArt.svelte';

	interface Props {
		host: { name: string; art: string | null; line: string };
		tag?: string;
		children?: Snippet;
		compact?: boolean;
	}

	let { host, tag = 'Host', children, compact = false }: Props = $props();
</script>

<div class="host-speech" class:compact>
	<HostArt art={host.art} name={host.name} size={compact ? 96 : 150} />
	<div class="box">
		<Speech tag={{ number: host.name.toUpperCase(), word: tag }} tail={false}>
			<p class="line">{host.line}</p>
			{#if children}{@render children()}{/if}
		</Speech>
	</div>
</div>

<style>
	.host-speech {
		display: flex;
		align-items: flex-end;
		gap: 10px;
		min-width: 0;
	}
	.box {
		flex: 1;
		min-width: 0;
		padding-top: 18px;
	}
	.box :global(.nj-speech__card) {
		padding: 28px 22px 16px 22px;
	}
	.box :global(.nj-speech__tag b) {
		font-size: 22px;
	}
	.line {
		margin: 0;
		font: 600 17px/1.4 var(--nj-font-body);
	}
	.compact .line {
		font-size: 15px;
	}
</style>
