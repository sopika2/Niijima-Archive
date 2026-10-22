<script lang="ts">
	import { Back, Button, Ransom } from '@niijima/design/svelte';
	import { enhance } from '$app/forms';
	import { OWNER_LABELS } from '$lib/types.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const owners = ['makoto', 'sae', 'shared'] as const;
</script>

<svelte:head>
	<title>{data.collection.name} · Thieves Den</title>
</svelte:head>

<div class="top"><Back href="/?c={data.collection.id}" label="Back" key={false} /></div>
<header class="heading">
	<Ransom as="h1" text={data.collection.name.toUpperCase()} seed={data.collection.id} />
</header>

<div class="stack narrow">
	{#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}
	<form method="POST" action="?/save" class="panel stack">
		<h2>Edit collection</h2>
		<div class="grid-2">
			<label class="field">
				<span>Name</span>
				<input type="text" name="name" required maxlength="80" value={data.collection.name} />
			</label>
			<label class="field">
				<span>Whose</span>
				<select name="owner" value={data.collection.owner}>
					{#each owners as owner (owner)}<option value={owner}>{OWNER_LABELS[owner]}</option>{/each}
				</select>
			</label>
		</div>
		<p class="hint">To pick a cover, open an item in this collection and choose “Use as cover”.</p>
		<div class="actions">
			<Button type="submit" variant="red">Save</Button>
			<button class="quiet" type="submit" formaction="?/clearCover">Reset cover</button>
		</div>
	</form>

	<div class="panel panel--ink row">
		<a class="nj-btn nj-btn--small" href="/collections/{data.collection.id}/export" download
			>Download .zip<i class="nj-btn__arrow"></i></a
		>
		<form
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (
					!confirm(
						`Delete “${data.collection.name}”? Its ${data.count} item(s) stay in the Den, unsorted.`
					)
				)
					cancel();
			}}
		>
			<button class="quiet danger" type="submit">Delete collection</button>
		</form>
	</div>
	<p class="hint">
		Deleting a collection keeps its {data.count} item{data.count === 1 ? '' : 's'}: they move to
		Unsorted.
	</p>
</div>

<style>
	.top {
		margin: 12px 0 10px;
	}
	.narrow {
		max-width: 720px;
	}
</style>
