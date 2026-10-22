<script lang="ts">
	import { Button, Plate, Ransom } from '@niijima/design/svelte';
	import { OWNER_LABELS } from '$lib/types.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const owners = ['makoto', 'sae', 'shared'] as const;
</script>

<svelte:head>
	<title>Collections · Thieves Den</title>
</svelte:head>

<header class="heading">
	<Ransom as="h1" text="COLLECTIONS" animate />
	<Plate variant="paper">Showcases in the Den</Plate>
</header>

<ul class="cards">
	{#each data.list as collection, i (collection.id)}
		<li class="card" style="--tilt: {i % 2 ? 1.2 : -1.4}deg">
			<a href="/?c={collection.id}" class="card__link">
				<span class="card__cover">
					{#if collection.cover}
						<img src={collection.cover.thumb} alt="" loading="lazy" />
					{:else}
						<span class="card__empty" aria-hidden="true"
							>{collection.name.slice(0, 1).toUpperCase()}</span
						>
					{/if}
				</span>
				<span class="card__name">{collection.name}</span>
				<span class="card__count"
					>{collection.count} {collection.count === 1 ? 'item' : 'items'}</span
				>
				{#if collection.owner !== data.persona}
					<span class="card__owner owner-tag" data-owner={collection.owner}
						>{OWNER_LABELS[collection.owner]}</span
					>
				{/if}
			</a>
			<span class="card__tools">
				<a class="quiet" href="/collections/{collection.id}">Edit</a>
				<a class="quiet" href="/collections/{collection.id}/export" download>.zip</a>
			</span>
		</li>
	{/each}
	{#if data.unsorted > 0}
		<li class="card card--unsorted" style="--tilt: 0.8deg">
			<a href="/?c=none" class="card__link">
				<span class="card__cover"><span class="card__empty" aria-hidden="true">?</span></span>
				<span class="card__name">Unsorted</span>
				<span class="card__count">{data.unsorted} {data.unsorted === 1 ? 'item' : 'items'}</span>
			</a>
			<span class="card__tools"
				><a class="quiet" href="/collections/none/export" download>.zip</a></span
			>
		</li>
	{/if}
</ul>

<div class="bottom">
	<form method="POST" action="?/create" class="panel stack new">
		<h2>New collection</h2>
		{#if form?.message}<p class="notice notice--bad" role="alert">{form.message}</p>{/if}
		<div class="grid-2">
			<label class="field">
				<span>Name</span>
				<input type="text" name="name" required maxlength="80" placeholder="Phantom Thieves" />
			</label>
			<label class="field">
				<span>Whose</span>
				<select name="owner" value={data.persona}>
					{#each owners as owner (owner)}<option value={owner}>{OWNER_LABELS[owner]}</option>{/each}
				</select>
			</label>
		</div>
		<div class="actions"><Button type="submit" variant="red">Create</Button></div>
	</form>

	<div class="panel panel--ink backup">
		<h3>Take it all with you</h3>
		<p>
			Every file you can see, with a captions.json holding your notes, tags and the tweets' words.
		</p>
		<a class="nj-btn nj-btn--small" href="/export" download
			>Download everything<i class="nj-btn__arrow"></i></a
		>
	</div>
</div>

<style>
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 22px 16px;
		margin: 0 0 36px;
		padding: 0;
		list-style: none;
	}
	@media (min-width: 900px) {
		.cards {
			grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		}
	}
	.card {
		position: relative;
		display: grid;
		transform: rotate(var(--tilt));
	}
	.card__link {
		position: relative;
		display: grid;
		gap: 2px;
		padding: 8px 8px 12px;
		background: var(--nj-paper);
		color: var(--nj-ink);
		text-decoration: none;
		box-shadow: 6px 6px 0 var(--nj-accent);
		transition: transform var(--nj-fast) var(--nj-snap);
	}
	.card__link:hover,
	.card__link:focus-visible {
		transform: scale(1.04) rotate(-1deg);
		box-shadow: 9px 9px 0 var(--nj-hi);
	}
	.card__cover {
		display: block;
		aspect-ratio: 4 / 3;
		overflow: hidden;
		background: var(--nj-ink);
		margin-bottom: 8px;
	}
	.card__cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.card__empty {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--nj-accent);
		font: 400 64px/1 var(--nj-font-display);
	}
	.card__name {
		font: 400 22px/1.05 var(--nj-font-display);
		text-transform: uppercase;
		overflow-wrap: anywhere;
	}
	.card__count {
		font: 700 12px/1.2 var(--nj-font-body);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--nj-red);
	}
	.card__owner {
		position: absolute;
		top: 14px;
		left: 14px;
	}
	.card__tools {
		display: flex;
		gap: 14px;
		padding: 2px 4px 0;
	}
	.card__tools .quiet {
		color: var(--nj-paper);
		font-size: 12px;
	}
	.bottom {
		display: grid;
		gap: 24px;
		align-items: start;
	}
	@media (min-width: 900px) {
		.bottom {
			grid-template-columns: 3fr 2fr;
		}
	}
	.backup p {
		margin: 0 0 18px;
	}
</style>
