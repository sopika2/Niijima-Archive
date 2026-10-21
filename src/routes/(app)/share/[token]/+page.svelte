<script lang="ts">
	import { Button, Plate, Ransom } from '@niijima/design/svelte';
	import HostSpeech from '$lib/components/HostSpeech.svelte';
	import PlaceFields from '$lib/components/PlaceFields.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
</script>

<svelte:head>
	<title>Shared · Thieves Den</title>
</svelte:head>

<header class="heading">
	<Ransom as="h1" text="NEW LOOT" animate />
	<Plate variant="paper">
		{data.files.length > 0
			? `${data.files.length} file${data.files.length === 1 ? '' : 's'}`
			: data.tweetUrl
				? 'A tweet'
				: 'Nothing usable'}
	</Plate>
</header>

<div class="share">
	{#if data.files.length > 0}
		<div class="previews">
			{#each data.files as file, i (i)}
				{#if file.kind === 'video'}
					<video src={file.src} muted playsinline preload="metadata" controls></video>
				{:else}
					<img src={file.src} alt="Shared file {i + 1}" />
				{/if}
			{/each}
		</div>
	{:else if data.tweetUrl}
		<p class="tweet-link"><span class="label">Tweet</span><code>{data.tweetUrl}</code></p>
	{:else}
		<HostSpeech
			host={{
				...data.host,
				line: "There's nothing here I can keep. Share a tweet link or pictures."
			}}
			compact
		/>
	{/if}

	{#each data.rejected as problem (problem)}<p class="notice notice--warn">
			Left out: {problem}
		</p>{/each}
	{#if form?.message}<p class="notice notice--bad" role="alert">{form.message}</p>{/if}

	{#if data.files.length > 0 || data.tweetUrl}
		<form method="POST" action="?/save" class="panel stack" onsubmit={() => (busy = true)}>
			<label class="field">
				<span>Your caption</span>
				<!-- svelte-ignore a11y_autofocus -->
				<textarea name="caption" autofocus placeholder="Why this one?">{data.suggested}</textarea>
			</label>
			<PlaceFields collections={data.collections} owner={data.persona} />
			{#if data.files.length > 0 && data.link}
				<p class="hint">Source: {data.link}</p>
			{/if}
			<div class="actions">
				<Button type="submit" variant="red" disabled={busy}
					>{busy ? 'Taking it…' : 'Steal it'}</Button
				>
				<button class="quiet" type="submit" formaction="?/discard" formnovalidate>Discard</button>
			</div>
		</form>
	{:else}
		<form method="POST" action="?/discard">
			<button class="nj-btn nj-btn--small" type="submit">Back to the Den</button>
		</form>
	{/if}
</div>

<style>
	.share {
		display: grid;
		gap: 18px;
		max-width: 720px;
	}
	.previews {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding-bottom: 6px;
	}
	.previews img,
	.previews video {
		flex: none;
		height: 180px;
		width: auto;
		max-width: 80vw;
		object-fit: cover;
		background: var(--nj-ink);
		box-shadow: 5px 5px 0 var(--nj-accent);
	}
	.tweet-link {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 12px 14px;
		background: var(--nj-ink);
		border-left: 6px solid var(--nj-hi);
		overflow-wrap: anywhere;
	}
</style>
