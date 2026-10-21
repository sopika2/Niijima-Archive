<script lang="ts">
	/**
	 * The host's picture from the assets folder, or, until the owner drops one in, a silhouette
	 * in the persona's colour. Never a broken image.
	 */
	interface Props {
		art: string | null;
		name: string;
		/** Height in pixels. */
		size?: number;
	}

	let { art, name, size = 160 }: Props = $props();
	let failed = $state(false);
</script>

<div class="host-art" style="--size: {size}px">
	{#if art && !failed}
		<img src={art} alt={name} onerror={() => (failed = true)} />
	{:else}
		<svg viewBox="0 0 100 120" role="img" aria-label="{name} (no picture yet)">
			<polygon
				class="burst"
				points="50,2 60,22 82,10 78,34 99,40 82,56 96,76 72,76 70,100 52,86 36,106 30,82 6,88 16,64 1,48 20,38 12,14 36,22"
			/>
			<path
				class="bust"
				d="M50 26c-13 0-21 10-21 24 0 9 4 17 10 21-14 4-25 13-28 31-1 6 3 11 9 11h60c6 0 10-5 9-11-3-18-14-27-28-31 6-4 10-12 10-21 0-14-8-24-21-24z"
			/>
			<path class="mask" d="M33 46c6-4 12-4 17 0 5-4 11-4 17 0-2 6-8 9-17 6-9 3-15 0-17-6z" />
		</svg>
	{/if}
</div>

<style>
	.host-art {
		flex: none;
		height: var(--size);
		aspect-ratio: 5 / 6;
		display: grid;
		place-items: end center;
	}
	img {
		height: 100%;
		width: auto;
		max-width: 100%;
		object-fit: contain;
		filter: drop-shadow(6px 6px 0 var(--nj-ink)) drop-shadow(-3px 0 0 var(--nj-hi));
	}
	svg {
		height: 100%;
		width: auto;
		overflow: visible;
	}
	.burst {
		fill: var(--nj-accent);
	}
	.bust {
		fill: var(--nj-ink);
		stroke: var(--nj-paper);
		stroke-width: 2.5;
	}
	.mask {
		fill: var(--nj-hi);
	}
</style>
