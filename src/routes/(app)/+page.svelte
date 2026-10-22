<script lang="ts">
	import { Counter, DateHud, Plate, Ransom } from '@niijima/design/svelte';
	import { enhance } from '$app/forms';
	import { goto, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import HostSpeech from '$lib/components/HostSpeech.svelte';
	import Lightbox from '$lib/components/Lightbox.svelte';
	import Tile from '$lib/components/Tile.svelte';
	import type { ItemView } from '$lib/types.ts';
	import { OWNER_LABELS } from '$lib/types.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/* The grid: the first page from the server, more appended while scrolling. */
	let items = $derived<ItemView[]>([...data.page.items]);
	let next = $derived<string | null>(data.page.next);
	let loading = $state(false);
	let loadError = $state(false);

	function params(extra: Record<string, string> = {}) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used at once, never stored
		const query = new URLSearchParams();
		if (data.filter.q) query.set('q', data.filter.q);
		if (data.filter.kind) query.set('type', data.filter.kind);
		if (data.filter.collectionId) query.set('c', data.filter.collectionId);
		if (data.filter.tag) query.set('tag', data.filter.tag);
		for (const [key, value] of Object.entries(extra)) query.set(key, value);
		return query;
	}

	async function loadMore() {
		if (!next || loading) return;
		loading = true;
		loadError = false;
		try {
			const response = await fetch(`/api/items?${params({ cursor: next })}`);
			if (!response.ok) throw new Error(String(response.status));
			const more = (await response.json()) as { items: ItemView[]; next: string | null };
			const known = new Set(items.map((item) => item.id));
			items = [...items, ...more.items.filter((item) => !known.has(item.id))];
			next = more.next;
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}

	function sentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting) && !loadError) void loadMore();
			},
			{ rootMargin: '900px 0px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	/* Filters live in the address, so a filtered view can be bookmarked and Back works. */
	let q = $derived(data.filter.q);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function filterTo(changes: Record<string, string>) {
		const query = params();
		for (const [key, value] of Object.entries(changes)) {
			if (value) query.set(key, value);
			else query.delete(key);
		}
		const search = query.toString();
		void goto(search ? `/?${search}` : '/', {
			keepFocus: true,
			noScroll: true,
			replaceState: 'q' in changes
		});
	}
	function typed() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => filterTo({ q: q.trim() }), 300);
	}

	/* The lightbox: ?item=<id> in the address, so the phone's Back gesture closes it. */
	const openId = $derived(page.state.item ?? data.opened?.id ?? null);
	const boxItems = $derived.by(() => {
		if (!openId) return items;
		if (items.some((item) => item.id === openId)) return items;
		return data.opened ? [data.opened] : items;
	});
	const boxIndex = $derived(openId ? boxItems.findIndex((item) => item.id === openId) : -1);

	function itemUrl(id: string | null) {
		const url = new URL(page.url);
		if (id) url.searchParams.set('item', id);
		else url.searchParams.delete('item');
		return url.pathname + url.search;
	}
	function open(item: ItemView) {
		pushState(itemUrl(item.id), { item: item.id });
	}
	function close() {
		if (page.state.item && !data.opened) history.back();
		else void goto(itemUrl(null), { replaceState: true, noScroll: true, keepFocus: true });
	}
	function step(index: number) {
		const item = boxItems[index];
		if (!item) return;
		replaceState(itemUrl(item.id), { item: item.id });
		if (index >= items.length - 4) void loadMore();
	}

	/* Bulk select: move or delete many at once. */
	let selecting = $state(false);
	let selected = $state<string[]>([]);
	function toggle(item: ItemView) {
		selected = selected.includes(item.id)
			? selected.filter((id) => id !== item.id)
			: [...selected, item.id];
	}
	function stopSelecting() {
		selecting = false;
		selected = [];
	}
	let moveTo = $state('');

	const kinds = [
		{ value: '', label: 'All' },
		{ value: 'tweet', label: 'Tweets' },
		{ value: 'image', label: 'Pictures' }
	];

	const title = $derived(
		data.collection?.name ??
			(data.filter.tag ? `#${data.filter.tag}` : data.filter.q ? 'Search' : 'The Den')
	);
</script>

<svelte:head>
	<title>{title} · Thieves Den</title>
</svelte:head>

{#if !data.filtered}
	<section class="hero">
		<div class="hero__title">
			<div class="hud"><DateHud timeZone={data.timezone} size="clamp(44px, 9vw, 64px)" /></div>
			<Ransom as="h1" text="THE DEN" size="clamp(52px, 13vw, 100px)" animate />
			<Counter value={String(data.total)} label="Stolen" />
		</div>
		<div class="hero__host">
			<HostSpeech host={data.host} tag="Thieves Den" compact={data.total > 0}>
				{#if data.total === 0}
					<p class="first">
						Nothing taken yet. <a href="/add">Steal something</a>: paste a tweet link or drop a
						picture.
					</p>
				{/if}
			</HostSpeech>
		</div>
	</section>
{:else}
	<header class="heading">
		<Ransom as="h1" text={title.toUpperCase()} seed={title} />
		<div class="row">
			<Plate variant="paper">{data.count} {data.count === 1 ? 'item' : 'items'}</Plate>
			{#if data.collection && data.collection.owner !== data.persona}
				<span class="owner-tag" data-owner={data.collection.owner}
					>{OWNER_LABELS[data.collection.owner]}</span
				>
			{/if}
			{#if data.collection}
				{#if data.collection.id !== 'none'}<a class="quiet" href="/collections/{data.collection.id}"
						>Edit collection</a
					>{/if}
				<a class="quiet" href="/collections/{data.collection.id}/export" download>Download .zip</a>
			{/if}
		</div>
	</header>
{/if}

<form
	class="filters"
	method="GET"
	action="/"
	role="search"
	onsubmit={(e) => (e.preventDefault(), filterTo({ q: q.trim() }))}
>
	<label class="search">
		<span class="nj-sr">Search captions and tweets</span>
		<input
			type="search"
			name="q"
			placeholder="Search captions, tweets, tags…"
			bind:value={q}
			oninput={typed}
			autocomplete="off"
		/>
	</label>
	<div class="kinds" role="group" aria-label="Type">
		{#each kinds as kind (kind.value)}
			<button
				type="button"
				class="kind"
				aria-pressed={data.filter.kind === kind.value}
				onclick={() => filterTo({ type: kind.value })}>{kind.label}</button
			>
		{/each}
	</div>
	<label class="pick">
		<span class="nj-sr">Collection</span>
		<select
			name="c"
			value={data.filter.collectionId}
			onchange={(e) => filterTo({ c: e.currentTarget.value })}
		>
			<option value="">All collections</option>
			{#each data.collections as collection (collection.id)}
				<option value={collection.id}>{collection.name}</option>
			{/each}
			{#if data.unsorted > 0}<option value="none">Unsorted ({data.unsorted})</option>{/if}
		</select>
	</label>
	<noscript><button class="nj-btn nj-btn--small" type="submit">Search</button></noscript>
</form>

{#if data.tags.length > 0}
	<nav class="tagbar" aria-label="Tags">
		{#if data.filter.tag}
			<button type="button" class="chip chip--on" onclick={() => filterTo({ tag: '' })}
				>#{data.filter.tag} ✕</button
			>
		{/if}
		{#each data.tags.filter((t) => t.tag !== data.filter.tag) as tag (tag.tag)}
			<button type="button" class="chip" onclick={() => filterTo({ tag: tag.tag })}
				>#{tag.tag}<small>{tag.count}</small></button
			>
		{/each}
	</nav>
{/if}

{#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}

{#if items.length > 0}
	<div class="toolbar">
		{#if data.filtered && !data.collection}<span class="found">{data.count} found</span>{/if}
		<button
			type="button"
			class="quiet"
			onclick={() => (selecting ? stopSelecting() : (selecting = true))}
		>
			{selecting ? 'Done selecting' : 'Select'}
		</button>
	</div>
	<div class="grid">
		{#each items as item (item.id)}
			<Tile
				{item}
				persona={data.persona}
				{selecting}
				selected={selected.includes(item.id)}
				onopen={open}
				ontoggle={toggle}
			/>
		{/each}
	</div>
	{#if next}
		<div class="more" use:sentinel>
			<button
				class="nj-btn nj-btn--small nj-btn--ghost"
				type="button"
				onclick={() => ((loadError = false), loadMore())}
				disabled={loading}
			>
				{loading ? 'Loading…' : loadError ? 'Try again' : 'Load more'}
			</button>
			<noscript><a href="/?{params({ cursor: next })}">More</a></noscript>
		</div>
	{/if}
{:else if data.filtered}
	<p class="empty">Nothing here matches. <a href="/">Show everything</a>.</p>
{/if}

{#if selecting}
	<form
		class="bulk"
		method="POST"
		use:enhance={({ action, formData, cancel }) => {
			const there = formData.get('zipline') === '1';
			const question = there
				? `Delete ${selected.length} item(s) here AND their files on Mementos? This can't be undone.`
				: data.mementos
					? `Delete ${selected.length} item(s)? Their files stay on Mementos.`
					: `Delete ${selected.length} item(s) and their files? This can't be undone.`;
			if (action.search.includes('delete') && !confirm(question)) cancel();
			return async ({ update }) => {
				await update({ reset: false });
				stopSelecting();
			};
		}}
	>
		{#each selected as id (id)}<input type="hidden" name="ids" value={id} />{/each}
		<span class="bulk__count">{selected.length} selected</span>
		<label class="pick">
			<span class="nj-sr">Move to</span>
			<select name="collection" bind:value={moveTo}>
				<option value="">Unsorted</option>
				{#each data.collections as collection (collection.id)}<option value={collection.id}
						>{collection.name}</option
					>{/each}
			</select>
		</label>
		<button
			class="nj-btn nj-btn--small nj-btn--red"
			formaction="?/move"
			disabled={selected.length === 0}>Move</button
		>
		<button class="quiet danger" formaction="?/delete" disabled={selected.length === 0}
			>Delete</button
		>
		{#if data.mementos}
			<label class="also">
				<input type="checkbox" name="zipline" value="1" />
				<span>…on Mementos too</span>
			</label>
		{/if}
	</form>
{/if}

{#if openId && boxIndex >= 0}
	<Lightbox
		items={boxItems}
		index={boxIndex}
		persona={data.persona}
		mementos={data.mementos}
		locale={data.locale}
		timezone={data.timezone}
		onindex={step}
		onclose={close}
	/>
{/if}

<style>
	.hero {
		display: grid;
		gap: 28px;
		margin: 8px 0 28px;
	}
	.hero__title {
		display: grid;
		justify-items: start;
		gap: 18px;
	}
	.hud {
		margin: 26px 0 14px 24px;
		isolation: isolate;
	}
	.first {
		margin: 10px 0 0;
		font-weight: 600;
	}
	.first a {
		color: var(--nj-red);
	}
	@media (min-width: 900px) {
		.hero {
			grid-template-columns: minmax(0, 1fr) minmax(320px, 520px);
			align-items: end;
		}
	}

	.filters {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 10px;
		margin-bottom: 12px;
	}
	.search {
		grid-column: 1 / -1;
	}
	.search input,
	.pick select {
		width: 100%;
		min-height: 46px;
		padding: 9px 12px;
		border: 0;
		border-radius: 0;
		background: var(--nj-paper);
		color: var(--nj-ink);
		font: 600 16px/1.2 var(--nj-font-body);
		box-shadow: 5px 5px 0 var(--nj-accent);
	}
	.search input:focus-visible,
	.pick select:focus-visible {
		outline: 3px solid var(--nj-focus);
	}
	.kinds {
		display: flex;
		gap: 4px;
	}
	.kind {
		min-height: 44px;
		padding: 8px 10px 5px;
		border: 0;
		background: var(--nj-ink);
		color: var(--nj-paper-muted);
		font: 400 16px/1 var(--nj-font-display);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
		clip-path: polygon(6% 0, 100% 6%, 94% 100%, 0 92%);
	}
	.kind[aria-pressed='true'] {
		background: var(--nj-hi);
		color: var(--nj-hi-ink);
	}
	.pick {
		min-width: 0;
	}
	@media (min-width: 900px) {
		.filters {
			grid-template-columns: minmax(0, 1fr) auto minmax(180px, 260px);
		}
		.search {
			grid-column: auto;
		}
	}

	.tagbar {
		display: flex;
		gap: 6px;
		margin: 0 calc(var(--gutter) * -1) 14px;
		padding: 4px var(--gutter) 8px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.chip {
		flex: none;
		min-height: 36px;
		padding: 6px 10px 4px;
		border: 2px solid var(--nj-paper-muted);
		background: var(--nj-veil);
		color: var(--nj-paper);
		font: 600 14px/1 var(--nj-font-body);
		cursor: pointer;
	}
	.chip small {
		margin-left: 5px;
		color: var(--nj-text-muted);
	}
	.chip--on {
		border-color: var(--nj-hi);
		background: var(--nj-hi);
		color: var(--nj-hi-ink);
	}

	.toolbar {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 12px;
		margin-bottom: 4px;
	}
	.found {
		margin-right: auto;
		color: var(--nj-text-muted);
		font-weight: 600;
	}

	.grid {
		--row: 128px;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.grid::after {
		content: '';
		flex-grow: 1000000;
	}
	@media (min-width: 640px) {
		.grid {
			--row: 180px;
			gap: 8px;
		}
	}
	@media (min-width: 1200px) {
		.grid {
			--row: 220px;
		}
	}
	.more {
		display: grid;
		place-items: center;
		padding: 28px 0;
	}
	.empty {
		padding: 30px 0;
		font-weight: 600;
	}

	.bulk {
		position: fixed;
		z-index: 20;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
		padding: 12px var(--gutter) calc(12px + env(safe-area-inset-bottom));
		background: var(--nj-ink);
		border-top: 4px solid var(--nj-accent);
	}
	.bulk__count {
		font: 400 20px/1 var(--nj-font-display);
		text-transform: uppercase;
	}
	.bulk .pick {
		flex: 1 1 140px;
	}
	.also {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		font-weight: 600;
		cursor: pointer;
	}
	.also input {
		width: 20px;
		height: 20px;
		accent-color: var(--nj-accent);
	}
</style>
