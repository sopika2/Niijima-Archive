<script lang="ts">
	import { Back, Button, Plate } from '@niijima/design/svelte';
	import { enhance } from '$app/forms';
	import PlaceFields from '$lib/components/PlaceFields.svelte';
	import TweetText from '$lib/components/TweetText.svelte';
	import { formatDate } from '$lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const item = $derived(data.item);
	const first = $derived(item.media[0] ?? null);
</script>

<svelte:head>
	<title>Edit · Thieves Den</title>
</svelte:head>

<div class="top"><Back href="/?item={item.id}" label="Back" key={false} /></div>

<div class="edit">
	<figure class="look">
		{#if first?.thumb}
			<img src={first.thumb} alt={first.alt ?? ''} />
		{:else if first?.url && first.kind !== 'image'}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video src={first.url} controls playsinline preload="metadata"></video>
		{:else if item.tweet}
			<div class="words"><TweetText text={item.tweet.text ?? item.tweet.url} /></div>
		{/if}
		<figcaption>
			<Plate variant="hi">{item.kind === 'tweet' ? 'Tweet' : 'Picture'}</Plate>
			Saved {formatDate(item.createdAt, data.locale, data.timezone)}
			{#if item.tweet}· <a href={item.tweet.url} target="_blank" rel="noopener noreferrer nofollow"
					>Open on X</a
				>{/if}
		</figcaption>
	</figure>

	<div class="stack">
		{#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}

		{#if item.tweet && item.needsRetry}
			<div class="panel panel--ink">
				<p class="retry">
					{item.fetchState === 'failed'
						? "The tweet couldn't be read"
						: "Some of its files didn't download"}{item.fetchError ? `: ${item.fetchError}` : '.'}
				</p>
				<form method="POST" action="?/refetch" use:enhance>
					<Button type="submit" variant="hi" small>Retry fetch</Button>
				</form>
			</div>
		{/if}

		<form
			method="POST"
			action="?/save"
			class="panel stack"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<h2>Edit</h2>
			<label class="field">
				<span>Your caption</span>
				<textarea name="caption" rows="4">{item.caption}</textarea>
			</label>
			<label class="field">
				<span>Source link</span>
				<input type="url" name="source" value={item.sourceUrl ?? ''} placeholder="https://…" />
			</label>
			<PlaceFields
				collections={data.collections}
				collection={item.collection?.id ?? ''}
				owner={item.owner}
				tags={item.tags.join(', ')}
			/>
			<div class="actions">
				<Button type="submit" variant="red">Save</Button>
			</div>
		</form>

		<div class="panel panel--ink row">
			{#if item.collection && first?.thumb}
				<form method="POST" action="?/cover" use:enhance>
					<button class="quiet" type="submit">Use as cover of {item.collection.name}</button>
				</form>
			{/if}
			{#if item.tweet && !item.needsRetry}
				<form method="POST" action="?/refetch" use:enhance>
					<button class="quiet" type="submit">Fetch the tweet again</button>
				</form>
			{/if}
			<form
				method="POST"
				action="?/delete"
				use:enhance={({ cancel }) => {
					if (!confirm('Delete this item and its files? This cannot be undone.')) cancel();
				}}
			>
				<button class="quiet danger" type="submit">Delete</button>
			</form>
		</div>
	</div>
</div>

<style>
	.top {
		margin: 12px 0 22px;
	}
	.edit {
		display: grid;
		gap: 24px;
		align-items: start;
	}
	@media (min-width: 900px) {
		.edit {
			grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
		}
	}
	.look {
		display: grid;
		gap: 12px;
		margin: 0;
	}
	.look img,
	.look video {
		width: 100%;
		max-height: 60dvh;
		object-fit: contain;
		background: var(--nj-ink);
		box-shadow: 8px 8px 0 var(--nj-accent);
	}
	.words {
		padding: 18px;
		background: var(--nj-paper);
		color: var(--nj-ink);
		font: 600 18px/1.4 var(--nj-font-body);
		box-shadow: 8px 8px 0 var(--nj-accent);
	}
	figcaption {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
		color: var(--nj-text-muted);
	}
	.retry {
		margin: 0 0 12px;
		font-weight: 600;
	}
</style>
