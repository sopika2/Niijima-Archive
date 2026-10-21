<script lang="ts">
	/** Where a stolen thing goes: its collection, whose it is, and its tags. */
	import type { CollectionOption, Owner } from '$lib/types.ts';
	import { OWNER_LABELS } from '$lib/types.ts';

	interface Props {
		collections: readonly CollectionOption[];
		collection?: string;
		owner: Owner;
		tags?: string;
		showTags?: boolean;
	}

	let { collections, collection = '', owner, tags = '', showTags = true }: Props = $props();
	const uid = $props.id();
	const owners = ['makoto', 'sae', 'shared'] as const;
</script>

<div class="grid-2">
	<label class="field" for="{uid}-collection">
		<span>Collection</span>
		<select id="{uid}-collection" name="collection" value={collection}>
			<option value="">Unsorted</option>
			{#each collections as option (option.id)}
				<option value={option.id}>{option.name}</option>
			{/each}
		</select>
	</label>
	<label class="field" for="{uid}-owner">
		<span>Whose</span>
		<select id="{uid}-owner" name="owner" value={owner}>
			{#each owners as value (value)}
				<option {value}>{OWNER_LABELS[value]}</option>
			{/each}
		</select>
	</label>
	{#if showTags}
		<label class="field tags" for="{uid}-tags">
			<span>Tags</span>
			<input
				id="{uid}-tags"
				name="tags"
				type="text"
				value={tags}
				placeholder="queen, bike, fanart"
				autocomplete="off"
				autocapitalize="none"
			/>
		</label>
	{/if}
</div>

<style>
	.tags {
		grid-column: 1 / -1;
	}
</style>
