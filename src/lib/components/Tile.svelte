<script lang="ts">
	/** One stolen thing in the grid: its picture (or the tweet's words), caption and badges. */
	import { formatDuration, tileRatio } from '$lib/format.ts';
	import type { ItemView, Persona } from '$lib/types.ts';
	import { OWNER_LABELS } from '$lib/types.ts';
	import { lazySrc } from './lazy.ts';

	interface Props {
		item: ItemView;
		persona: Persona;
		selecting: boolean;
		selected: boolean;
		onopen: (item: ItemView) => void;
		ontoggle: (item: ItemView) => void;
	}

	let { item, persona, selecting, selected, onopen, ontoggle }: Props = $props();

	const first = $derived(item.media[0] ?? null);
	const ratio = $derived(first ? tileRatio(first.width, first.height) : 1.25);
	const badge = $derived.by(() => {
		if (first?.kind === 'gif') return 'GIF';
		if (first?.kind === 'video') return formatDuration(first.durationMs) || 'Video';
		return null;
	});

	function click(event: MouseEvent) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
		event.preventDefault();
		if (selecting) ontoggle(item);
		else onopen(item);
	}
</script>

<a
	class="tile"
	class:is-selected={selected}
	class:is-text={!first}
	href="/item/{item.id}"
	style="--r: {ratio}"
	onclick={click}
	aria-label={item.caption || item.tweet?.text?.slice(0, 80) || 'Saved item'}
	data-item={item.id}
>
	<span class="frame">
		{#if first?.thumb}
			<img
				src={first.thumb}
				alt={first.alt ?? ''}
				loading="lazy"
				decoding="async"
				width={first.width ?? undefined}
				height={first.height ?? undefined}
			/>
		{:else if first?.url && first.kind !== 'image'}
			<video use:lazySrc={`${first.url}#t=0.1`} muted playsinline preload="metadata"></video>
		{:else if first?.url}
			<img src={first.url} alt={first.alt ?? ''} loading="lazy" decoding="async" />
		{:else if first?.gone}
			<span class="missing">Deleted on<br />Mementos</span>
		{:else if first}
			<span class="missing">File missing<br />Retry from the item</span>
		{:else}
			<span class="words">
				<span class="words__text">{item.tweet?.text || item.tweet?.url || 'Tweet'}</span>
				{#if item.tweet?.authorHandle}<span class="words__by">@{item.tweet.authorHandle}</span>{/if}
			</span>
		{/if}
	</span>

	<span class="badges">
		{#if item.owner !== persona}
			<span class="owner owner-tag" data-owner={item.owner}>{OWNER_LABELS[item.owner]}</span>
		{/if}
		{#if item.kind === 'tweet'}<span class="badge badge--tweet">Tweet</span>{/if}
		{#if badge}<span class="badge">{badge}</span>{/if}
		{#if item.media.length > 1}<span class="badge">×{item.media.length}</span>{/if}
		{#if item.needsRetry}<span class="badge badge--warn">Retry</span>{/if}
		{#if item.media.some((file) => file.gone)}<span class="badge badge--warn">Gone</span>{/if}
	</span>
	{#if item.caption}<span class="caption">{item.caption}</span>{/if}
	{#if selecting}<span class="check" aria-hidden="true">{selected ? '✓' : ''}</span><span
			class="nj-sr">{selected ? 'Selected' : 'Not selected'}</span
		>{/if}
</a>

<style>
	.tile {
		position: relative;
		display: block;
		flex: calc(var(--r) * 100) 1 calc(var(--r) * var(--row));
		min-width: 0;
		color: var(--nj-paper);
		text-decoration: none;
		background: var(--nj-ink);
		outline-offset: 2px;
		transition: transform var(--nj-fast) var(--nj-snap);
	}
	.tile:hover {
		transform: rotate(-1deg) scale(1.02);
		z-index: 2;
		box-shadow: 6px 6px 0 var(--nj-accent);
	}
	.frame {
		display: block;
		aspect-ratio: var(--r);
		overflow: hidden;
		background: var(--nj-surface-raised);
	}
	.frame img,
	.frame video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.missing {
		display: grid;
		place-items: center;
		height: 100%;
		padding: 8px;
		color: var(--nj-paper-muted);
		font: 700 12px/1.3 var(--nj-font-body);
		letter-spacing: 0.1em;
		text-align: center;
		text-transform: uppercase;
	}
	.is-text .frame {
		background: var(--nj-paper);
		color: var(--nj-ink);
	}
	.words {
		display: grid;
		align-content: start;
		gap: 6px;
		height: 100%;
		padding: 30px 12px 30px;
	}
	.words__text {
		display: -webkit-box;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font: 600 14px/1.3 var(--nj-font-body);
		overflow-wrap: anywhere;
	}
	.words__by {
		font: 700 11px/1 var(--nj-font-body);
		letter-spacing: 0.08em;
		color: var(--nj-red);
	}
	.badges {
		position: absolute;
		top: 6px;
		right: 6px;
		left: 6px;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: flex-start;
		gap: 4px;
		pointer-events: none;
	}
	.badge {
		padding: 3px 6px 2px;
		background: var(--nj-ink);
		color: var(--nj-paper);
		font: 400 12px/1 var(--nj-font-display);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		transform: rotate(-3deg);
	}
	.badge--tweet {
		background: var(--nj-hi);
		color: var(--nj-hi-ink);
	}
	.badge--warn {
		background: var(--nj-sae-gold);
		color: var(--nj-ink);
	}
	.owner {
		margin-right: auto;
	}
	.caption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 18px 8px 6px;
		background: linear-gradient(transparent, var(--nj-veil) 40%, var(--nj-ink));
		font: 600 13px/1.25 var(--nj-font-body);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.is-text .caption {
		background: var(--nj-ink);
		padding-top: 6px;
	}
	.check {
		position: absolute;
		left: 6px;
		bottom: 30px;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: 3px solid var(--nj-paper);
		background: var(--nj-veil);
		color: var(--nj-ink);
		font: 900 18px/1 var(--nj-font-body);
	}
	.is-selected {
		box-shadow: 0 0 0 4px var(--nj-hi);
	}
	.is-selected .check {
		background: var(--nj-hi);
	}
	@media (prefers-reduced-motion: reduce) {
		.tile:hover {
			transform: none;
		}
	}
</style>
