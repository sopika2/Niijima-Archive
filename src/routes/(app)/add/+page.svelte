<script lang="ts">
	import { Button, Plate, Ransom } from '@niijima/design/svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import PlaceFields from '$lib/components/PlaceFields.svelte';
	import { ACCEPT, uploadFile, videoPoster } from '$lib/upload.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/* ── A tweet ── */
	let tweetUrl = $state('');
	let tweetBusy = $state(false);

	/* ── Pictures: chosen files, each with its own caption and source ── */
	interface Pick {
		readonly key: number;
		readonly file: File;
		readonly preview: string;
		caption: string;
		source: string;
		state: 'ready' | 'sending' | 'done' | 'failed';
		progress: number;
		error: string;
		id: string;
	}
	let picks = $state<Pick[]>([]);
	let counter = 0;
	let dragging = $state(false);
	let sending = $state(false);
	let picksForm: HTMLFormElement | undefined = $state();
	const maxBytes = $derived(data.maxUploadMb * 1e6);

	function add(files: Iterable<File>) {
		for (const file of files) {
			if (!/^(image|video)\//.test(file.type) && file.type !== '') continue;
			picks.push({
				key: counter++,
				file,
				preview: URL.createObjectURL(file),
				caption: '',
				source: '',
				state: 'ready',
				progress: 0,
				error: file.size > maxBytes ? `Over the ${data.maxUploadMb} MB limit.` : '',
				id: ''
			});
		}
	}
	function remove(pick: Pick) {
		URL.revokeObjectURL(pick.preview);
		picks = picks.filter((p) => p.key !== pick.key);
	}

	async function sendAll(event: SubmitEvent) {
		event.preventDefault();
		if (!picksForm) return;
		sending = true;
		const shared = new FormData(picksForm);
		for (const pick of picks) {
			if (pick.state === 'done' || pick.file.size > maxBytes) continue;
			pick.state = 'sending';
			pick.error = '';
			const fields = new FormData();
			fields.set('file', pick.file);
			for (const name of ['collection', 'owner', 'tags'])
				fields.set(name, String(shared.get(name) ?? ''));
			fields.set('caption', pick.caption);
			fields.set('source', pick.source);
			if (pick.file.type.startsWith('video/')) {
				const poster = await videoPoster(pick.file);
				if (poster) fields.set('poster', poster, 'poster.jpg');
			}
			const result = await uploadFile(fields, (fraction) => (pick.progress = fraction));
			pick.state = result.ok ? 'done' : 'failed';
			pick.error = result.error ?? '';
			pick.id = result.id ?? '';
		}
		sending = false;
		void invalidateAll();
	}
	const done = $derived(picks.filter((p) => p.state === 'done').length);
	const waiting = $derived(
		picks.filter((p) => p.state !== 'done' && p.file.size <= maxBytes).length
	);

	onMount(() => {
		// Paste a picture (desktop) or a tweet link anywhere on the page.
		const paste = (event: ClipboardEvent) => {
			const files = [...(event.clipboardData?.files ?? [])];
			if (files.length > 0) {
				event.preventDefault();
				add(files);
				return;
			}
			const target = event.target as HTMLElement | null;
			const pasted = event.clipboardData?.getData('text') ?? '';
			if (
				!target?.closest('input, textarea') &&
				/https?:\/\/\S*(x|twitter)\.com\/\S+\/status\/\d+/.test(pasted)
			) {
				tweetUrl = pasted.trim();
				event.preventDefault();
			}
		};
		window.addEventListener('paste', paste);
		return () => {
			window.removeEventListener('paste', paste);
			for (const pick of picks) URL.revokeObjectURL(pick.preview);
		};
	});
</script>

<svelte:head>
	<title>Steal · Thieves Den</title>
</svelte:head>

<header class="heading">
	<Ransom as="h1" text="STEAL" animate />
	<Plate variant="paper">A tweet or pictures · your note on why</Plate>
</header>

<div class="columns">
	<section class="panel" aria-labelledby="tweet-title">
		<h2 id="tweet-title">A tweet</h2>
		{#if form?.tweet && 'id' in form.tweet}
			{#if form.tweet.duplicate}
				<p class="notice notice--warn" role="status">
					Already in the Den. <a href="/?item={form.tweet.id}">Open it</a>.
				</p>
			{:else if form.tweet.fetched}
				<p class="notice" role="status">
					Stolen{form.tweet.error ? ` (${form.tweet.error})` : ''}.
					<a href="/?item={form.tweet.id}">Open it</a>.
				</p>
			{:else}
				<p class="notice notice--warn" role="status">
					Saved the link and your caption, but the tweet couldn't be read ({form.tweet.error}).
					Retry from
					<a href="/item/{form.tweet.id}">the item</a>.
				</p>
			{/if}
		{/if}
		{#if form?.tweet && 'error' in form.tweet && !('id' in form.tweet)}
			<p class="notice notice--bad" role="alert">{form.tweet.error}</p>
		{/if}
		<form
			method="POST"
			action="?/tweet"
			class="stack"
			use:enhance={() => {
				tweetBusy = true;
				return async ({ update, result }) => {
					await update({ reset: result.type === 'success' });
					if (result.type === 'success') tweetUrl = '';
					tweetBusy = false;
				};
			}}
		>
			<label class="field">
				<span>Link</span>
				<input
					type="url"
					name="url"
					required
					inputmode="url"
					placeholder="https://x.com/…/status/…"
					bind:value={tweetUrl}
					autocomplete="off"
				/>
			</label>
			<label class="field">
				<span>Your caption</span>
				<textarea name="caption" placeholder="Why this one? What should future you remember?"
				></textarea>
			</label>
			<PlaceFields
				collections={data.collections}
				collection={data.collection}
				owner={data.persona}
			/>
			<div class="actions">
				<Button type="submit" variant="red" disabled={tweetBusy}
					>{tweetBusy ? 'Taking it…' : 'Steal the tweet'}</Button
				>
			</div>
			<p class="hint">
				Text, author, date and every photo or video are copied here, so they stay even if the tweet
				is deleted.
			</p>
		</form>
	</section>

	<section class="panel" aria-labelledby="files-title">
		<h2 id="files-title">Pictures, GIFs, videos</h2>
		{#if form?.upload}
			<p class="notice {form.upload.errors.length ? 'notice--warn' : ''}" role="status">
				{form.upload.error ??
					`Stole ${form.upload.saved} file${form.upload.saved === 1 ? '' : 's'}.`}
				{#each form.upload.errors as problem (problem)}<br />{problem}{/each}
			</p>
		{/if}
		<form
			method="POST"
			action="?/upload"
			enctype="multipart/form-data"
			class="stack"
			bind:this={picksForm}
			onsubmit={sendAll}
		>
			<label
				class="drop"
				class:is-over={dragging}
				ondragover={(e) => (e.preventDefault(), (dragging = true))}
				ondragleave={() => (dragging = false)}
				ondrop={(e) => {
					e.preventDefault();
					dragging = false;
					add(e.dataTransfer?.files ?? []);
				}}
			>
				<input
					class="nj-sr"
					type="file"
					name="files"
					multiple
					accept={ACCEPT}
					onchange={(e) => {
						add(e.currentTarget.files ?? []);
						e.currentTarget.value = '';
					}}
				/>
				<span class="drop__big">Drop files here</span>
				<span class="drop__small"
					>or tap to choose · paste works too · up to {data.maxUploadMb} MB each</span
				>
			</label>

			{#if picks.length > 0}
				<ul class="picks">
					{#each picks as pick (pick.key)}
						<li class="pick" data-state={pick.state}>
							<div class="pick__thumb">
								{#if pick.file.type.startsWith('video/')}
									<video src={pick.preview} muted playsinline preload="metadata"></video>
								{:else}
									<img src={pick.preview} alt="" />
								{/if}
								{#if pick.state === 'sending'}<span class="bar" style="--p: {pick.progress}"
									></span>{/if}
								{#if pick.state === 'done'}<span class="ok">✓</span>{/if}
							</div>
							<div class="pick__fields">
								<input
									type="text"
									placeholder="Caption for this one"
									bind:value={pick.caption}
									aria-label="Caption for {pick.file.name}"
									disabled={pick.state === 'done'}
								/>
								<input
									type="url"
									placeholder="Source link (optional)"
									bind:value={pick.source}
									aria-label="Source for {pick.file.name}"
									disabled={pick.state === 'done'}
								/>
								{#if pick.error}<p class="pick__error">{pick.error}</p>{/if}
								{#if pick.state === 'done'}<a class="pick__open" href="/?item={pick.id}">Open</a
									>{/if}
							</div>
							{#if pick.state !== 'done' && pick.state !== 'sending'}
								<button
									type="button"
									class="quiet"
									onclick={() => remove(pick)}
									aria-label="Remove {pick.file.name}">✕</button
								>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			<noscript>
				<label class="field"><span>Caption</span><textarea name="caption"></textarea></label>
				<label class="field"><span>Source link</span><input type="url" name="source" /></label>
			</noscript>
			<PlaceFields
				collections={data.collections}
				collection={data.collection}
				owner={data.persona}
			/>
			<div class="actions">
				<Button
					type="submit"
					variant="red"
					disabled={sending || (picks.length > 0 && waiting === 0)}
				>
					{sending
						? 'Taking them…'
						: waiting > 0
							? `Steal ${waiting} file${waiting === 1 ? '' : 's'}`
							: 'Steal'}
				</Button>
				{#if done > 0 && !sending}
					<a class="quiet" href="/">See them in the Den</a>
					<button
						type="button"
						class="quiet"
						onclick={() => picks.filter((p) => p.state === 'done').forEach(remove)}
						>Clear done</button
					>
				{/if}
			</div>
		</form>
	</section>
</div>

<section class="panel panel--ink phone">
	<h3>From your phone</h3>
	<p>
		<b>Android:</b> open the Den in Chrome, choose <i>Install app</i>, and the Thieves Den appears
		in the share sheet of X, your gallery and every other app.
	</p>
	<p>
		<b>iPhone:</b> Safari can't receive shares. Paste the link here, or use the iOS Shortcut
		described in the README (it posts to <code>/api/save</code> with your save token).
	</p>
</section>

<style>
	.columns {
		display: grid;
		gap: 28px;
		align-items: start;
	}
	@media (min-width: 1000px) {
		.columns {
			grid-template-columns: 1fr 1fr;
		}
	}
	.drop {
		display: grid;
		place-items: center;
		gap: 6px;
		min-height: 140px;
		padding: 20px;
		border: 3px dashed var(--nj-ink);
		background:
			radial-gradient(var(--nj-dot) 30%, transparent 34%) 0 0 / 13px 13px,
			var(--nj-paper);
		text-align: center;
		cursor: pointer;
		transition: transform var(--nj-fast) var(--nj-snap);
	}
	.drop:hover,
	.drop.is-over,
	.drop:focus-within {
		transform: rotate(-1deg) scale(1.01);
		border-color: var(--nj-accent);
	}
	.drop:focus-within {
		outline: 3px solid var(--nj-focus);
	}
	.drop__big {
		font: 400 30px/1 var(--nj-font-display);
		text-transform: uppercase;
	}
	.drop__small {
		font-size: 14px;
	}
	.picks {
		display: grid;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pick {
		display: grid;
		grid-template-columns: 76px 1fr auto;
		gap: 10px;
		align-items: start;
		padding: 8px;
		border: 2px solid var(--nj-ink);
	}
	.pick[data-state='done'] {
		border-color: var(--nj-accent);
		opacity: 0.8;
	}
	.pick__thumb {
		position: relative;
		width: 76px;
		height: 76px;
		background: var(--nj-ink);
	}
	.pick__thumb img,
	.pick__thumb video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.bar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 6px;
		width: calc(var(--p) * 100%);
		background: var(--nj-accent);
	}
	.ok {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--nj-veil);
		color: var(--nj-paper);
		font: 900 34px/1 var(--nj-font-body);
	}
	.pick__fields {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.pick__fields input {
		min-height: 40px !important;
		padding: 6px 8px !important;
		font-size: 15px !important;
	}
	.pick__error {
		margin: 0;
		color: var(--nj-red);
		font-weight: 700;
		font-size: 14px;
	}
	.pick__open {
		color: var(--nj-red);
		font-weight: 700;
	}
	.phone {
		margin-top: 28px;
	}
	.phone p {
		margin: 0 0 8px;
	}
	.phone code {
		color: var(--nj-hi);
	}
</style>
