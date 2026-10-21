<script lang="ts">
	/**
	 * The open item: its pictures or video full size, and everything about it beside (desktop)
	 * or below (phone). ←/→ or a swipe step through each file, then on to the next item.
	 */
	import { DateHud, Plate } from '@niijima/design/svelte';
	import { onMount, tick } from 'svelte';
	import { formatDate } from '$lib/format.ts';
	import type { ItemView, Persona } from '$lib/types.ts';
	import { OWNER_LABELS } from '$lib/types.ts';
	import TweetText from './TweetText.svelte';

	interface Props {
		items: readonly ItemView[];
		index: number;
		persona: Persona;
		mementos: boolean;
		locale: string;
		timezone: string;
		onindex: (index: number) => void;
		onclose: () => void;
	}

	let { items, index, persona, mementos, locale, timezone, onindex, onclose }: Props = $props();

	let mediaIndex = $state(0);
	let lastItem = '';
	const item = $derived(items[index]);
	const file = $derived(item?.media[mediaIndex] ?? null);
	const hasPrev = $derived(index > 0 || mediaIndex > 0);
	const hasNext = $derived(
		index < items.length - 1 || (item ? mediaIndex < item.media.length - 1 : false)
	);

	$effect.pre(() => {
		// A different item starts on its first file (unless we stepped back into it).
		if (item && item.id !== lastItem) {
			if (mediaIndex >= item.media.length) mediaIndex = 0;
			lastItem = item.id;
		}
	});

	function next() {
		if (!item) return;
		if (mediaIndex < item.media.length - 1) mediaIndex++;
		else if (index < items.length - 1) {
			mediaIndex = 0;
			onindex(index + 1);
		}
	}
	function prev() {
		if (mediaIndex > 0) mediaIndex--;
		else if (index > 0) {
			const before = items[index - 1]!;
			mediaIndex = Math.max(0, before.media.length - 1);
			onindex(index - 1);
		}
	}

	function keydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select')) return;
		if (event.key === 'Escape') onclose();
		else if (event.key === 'ArrowRight') next();
		else if (event.key === 'ArrowLeft') prev();
	}

	/* Swipe on phones: a mostly sideways flick of 50px or more. */
	let start: { x: number; y: number } | null = null;
	function pointerdown(event: PointerEvent) {
		if (event.pointerType !== 'mouse') start = { x: event.clientX, y: event.clientY };
	}
	function pointerup(event: PointerEvent) {
		if (!start) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		start = null;
		if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
			if (dx < 0) next();
			else prev();
		}
	}

	let closeButton: HTMLButtonElement | undefined = $state();
	onMount(() => {
		const before = document.activeElement as HTMLElement | null;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		void tick().then(() => closeButton?.focus());
		return () => {
			document.body.style.overflow = overflow;
			before?.focus?.();
		};
	});

	/* "Copy Mementos link": upload to Zipline once, then copy. */
	let mirrors = $state<Record<string, string>>({});
	let copyState = $state<{ id: string; text: string; link?: string } | null>(null);
	async function mementosLink(id: string): Promise<string> {
		const known = mirrors[id] ?? item?.media.find((m) => m.id === id)?.mirrorUrl;
		if (known) return known;
		const response = await fetch(`/api/media/${id}/mementos`, { method: 'POST' });
		const body = (await response.json().catch(() => ({}))) as {
			url?: string;
			error?: string;
			message?: string;
		};
		if (!response.ok || !body.url)
			throw new Error(body.error ?? body.message ?? 'Mementos did not answer.');
		mirrors[id] = body.url;
		return body.url;
	}
	async function copyMementos(id: string) {
		copyState = { id, text: 'Uploading…' };
		const link = mementosLink(id);
		try {
			if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
				// Safari needs the clipboard write to start inside the tap, with the text to follow.
				await navigator.clipboard.write([
					new ClipboardItem({
						'text/plain': link.then((url) => new Blob([url], { type: 'text/plain' }))
					})
				]);
			} else {
				await navigator.clipboard.writeText(await link);
			}
			copyState = { id, text: 'Copied', link: await link };
		} catch (error) {
			const url = await link.catch(() => null);
			copyState = url
				? { id, text: 'Copy it from here:', link: url }
				: { id, text: error instanceof Error ? error.message : 'Mementos did not answer.' };
		}
	}

	const posted = $derived(item?.tweet?.postedAt ? new Date(item.tweet.postedAt) : null);
</script>

<svelte:window onkeydown={keydown} />

{#if item}
	<div class="lightbox" role="dialog" aria-modal="true" aria-label={item.caption || 'Saved item'}>
		<div class="stage" onpointerdown={pointerdown} onpointerup={pointerup} role="presentation">
			{#if file?.url && file.kind === 'video'}
				{#key file.id}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={file.url}
						poster={file.thumb ?? undefined}
						controls
						playsinline
						preload="metadata"
					></video>
				{/key}
			{:else if file?.url && file.kind === 'gif' && file.mime?.startsWith('video/')}
				{#key file.id}
					<video
						src={file.url}
						poster={file.thumb ?? undefined}
						autoplay
						loop
						muted
						playsinline
						aria-label={file.alt ?? 'GIF'}
					></video>
				{/key}
			{:else if file?.url}
				{#key file.id}<img src={file.url} alt={file.alt ?? ''} />{/key}
			{:else if file}
				<p class="gone">This file didn't download. Retry the fetch from the item's page.</p>
			{:else}
				<div class="words">
					<TweetText text={item.tweet?.text ?? ''} />
				</div>
			{/if}

			{#if hasPrev}<button
					class="step step--prev"
					type="button"
					onclick={prev}
					aria-label="Previous">‹</button
				>{/if}
			{#if hasNext}<button class="step step--next" type="button" onclick={next} aria-label="Next"
					>›</button
				>{/if}
			{#if item.media.length > 1}
				<span class="count">{mediaIndex + 1}/{item.media.length}</span>
			{/if}
		</div>

		<aside class="info">
			<div class="info__top">
				<Plate variant="hi">{item.kind === 'tweet' ? 'Tweet' : 'Picture'}</Plate>
				{#if item.owner !== persona}<span class="owner-tag" data-owner={item.owner}
						>{OWNER_LABELS[item.owner]}</span
					>{/if}
				<button
					class="close"
					type="button"
					onclick={onclose}
					bind:this={closeButton}
					aria-label="Close"
				>
					<span aria-hidden="true">✕</span><kbd>Esc</kbd>
				</button>
			</div>

			<section class="note">
				<span class="note__label">Why it was stolen</span>
				{#if item.caption}
					<p class="note__text">{item.caption}</p>
				{:else}
					<p class="note__text note__text--empty">
						No caption yet. <a href="/item/{item.id}">Add one</a>.
					</p>
				{/if}
			</section>

			{#if item.tweet}
				<section class="tweet">
					<p class="tweet__by">
						<b>{item.tweet.authorName ?? 'Unknown'}</b>
						{#if item.tweet.authorHandle}<span>@{item.tweet.authorHandle}</span>{/if}
					</p>
					{#if item.tweet.text && item.media.length > 0}<TweetText text={item.tweet.text} />{/if}
					{#if item.tweet.quote}
						<blockquote class="quote">
							<p class="tweet__by">
								<b>{item.tweet.quote.authorName}</b> <span>@{item.tweet.quote.authorHandle}</span>
							</p>
							<TweetText text={item.tweet.quote.text} />
							<a href={item.tweet.quote.url} target="_blank" rel="noopener noreferrer nofollow"
								>Quoted tweet</a
							>
						</blockquote>
					{/if}
					{#if item.needsRetry}
						<p class="notice notice--warn">
							{item.fetchState === 'failed'
								? "Couldn't read this tweet"
								: "Some files didn't download"}{item.fetchError ? `: ${item.fetchError}` : '.'}
						</p>
						<form method="POST" action="/item/{item.id}?/refetch">
							<button class="nj-btn nj-btn--small nj-btn--hi" type="submit"
								>Retry fetch<i class="nj-btn__arrow"></i></button
							>
						</form>
					{/if}
					{#if posted}
						<div class="when">
							<DateHud date={posted} timeZone={timezone} size="34px" />
							<span class="when__label"
								>Posted {formatDate(item.tweet.postedAt, locale, timezone)}</span
							>
						</div>
					{/if}
				</section>
			{/if}

			<dl class="facts">
				<dt>Saved</dt>
				<dd>{formatDate(item.createdAt, locale, timezone)}</dd>
				<dt>Collection</dt>
				<dd>
					{#if item.collection}<a href="/?c={item.collection.id}">{item.collection.name}</a
						>{:else}<a href="/?c=none">Unsorted</a>{/if}
				</dd>
				{#if item.tags.length > 0}
					<dt>Tags</dt>
					<dd class="tags">
						{#each item.tags as tag (tag)}<a href="/?tag={encodeURIComponent(tag)}">#{tag}</a
							>{/each}
					</dd>
				{/if}
				{#if item.tweet}
					<dt>Original</dt>
					<dd>
						<a href={item.tweet.url} target="_blank" rel="noopener noreferrer nofollow">Open on X</a
						>
					</dd>
				{/if}
				{#if item.sourceUrl}
					<dt>Source</dt>
					<dd>
						<a href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow"
							>{item.sourceUrl.replace(/^https?:\/\//, '').slice(0, 60)}</a
						>
					</dd>
				{/if}
			</dl>

			<div class="actions">
				<a class="nj-btn nj-btn--small" href="/item/{item.id}">Edit<i class="nj-btn__arrow"></i></a>
				{#if file?.url}
					<a class="quiet" href={file.url} download>Download file</a>
				{/if}
				{#if mementos && file?.url}
					<button class="quiet" type="button" onclick={() => copyMementos(file.id)}
						>Copy Mementos link</button
					>
				{/if}
			</div>
			{#if copyState && file && copyState.id === file.id}
				<p class="copied" role="status">
					{copyState.text}
					{#if copyState.link}<input
							class="input"
							readonly
							value={copyState.link}
							onfocus={(e) => e.currentTarget.select()}
						/>{/if}
				</p>
			{/if}
		</aside>
	</div>
{/if}

<style>
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		grid-template-rows: minmax(46dvh, 1fr) auto;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--nj-ink);
		color: var(--nj-paper);
	}
	.stage {
		position: sticky;
		top: 0;
		display: grid;
		place-items: center;
		min-height: 46dvh;
		max-height: 70dvh;
		background:
			radial-gradient(var(--nj-dot-light) 30%, transparent 34%) 0 0 / 13px 13px,
			var(--nj-field-deep);
		touch-action: pan-y;
		user-select: none;
	}
	.stage img,
	.stage video {
		max-width: 100%;
		max-height: 70dvh;
		object-fit: contain;
	}
	.words {
		max-width: 34em;
		margin: 24px 16px;
		padding: 20px 22px;
		background: var(--nj-paper);
		color: var(--nj-ink);
		font: 600 20px/1.4 var(--nj-font-body);
		transform: rotate(-1deg);
		box-shadow: 8px 8px 0 var(--nj-accent);
	}
	.gone {
		max-width: 22em;
		padding: 16px;
		text-align: center;
		color: var(--nj-paper-muted);
	}
	.step {
		position: absolute;
		top: 50%;
		display: grid;
		place-items: center;
		width: 48px;
		height: 64px;
		margin-top: -32px;
		border: 0;
		background: var(--nj-ink);
		color: var(--nj-paper);
		font: 400 44px/1 var(--nj-font-display);
		cursor: pointer;
		clip-path: polygon(10% 0, 100% 6%, 90% 100%, 0 94%);
	}
	.step:hover,
	.step:focus-visible {
		background: var(--nj-accent);
	}
	.step--prev {
		left: 6px;
	}
	.step--next {
		right: 6px;
	}
	.count {
		position: absolute;
		bottom: 8px;
		left: 50%;
		translate: -50% 0;
		padding: 4px 8px 3px;
		background: var(--nj-ink);
		font: 400 15px/1 var(--nj-font-display);
		letter-spacing: 0.1em;
	}
	.info {
		position: relative;
		z-index: 1;
		display: grid;
		align-content: start;
		gap: 18px;
		padding: 18px var(--gutter) 40px;
		background: var(--nj-field);
		border-top: 6px solid var(--nj-accent);
	}
	.info__top {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.close {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		margin-left: auto;
		padding: 8px 14px 6px;
		border: 0;
		background: var(--nj-paper);
		color: var(--nj-ink);
		font: 400 20px/1 var(--nj-font-display);
		cursor: pointer;
		transform: rotate(3deg);
		box-shadow: -5px 5px 0 var(--nj-accent);
	}
	.close kbd {
		padding: 4px 5px 3px;
		background: var(--nj-ink);
		color: var(--nj-paper);
		font: 700 10px/1 var(--nj-font-body);
		letter-spacing: 0.12em;
	}
	.note {
		padding: 14px 16px;
		background: var(--nj-paper);
		color: var(--nj-ink);
		transform: rotate(-1deg);
		box-shadow: 6px 6px 0 var(--nj-hi);
	}
	.note__label {
		display: block;
		margin-bottom: 4px;
		font: 700 11px/1 var(--nj-font-body);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--nj-red);
	}
	.note__text {
		margin: 0;
		font: 700 20px/1.35 var(--nj-font-body);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.note__text--empty {
		font-weight: 500;
		font-size: 16px;
	}
	.note a {
		color: var(--nj-ink);
	}
	.tweet {
		display: grid;
		gap: 10px;
		font-size: 16px;
	}
	.tweet__by {
		margin: 0;
	}
	.tweet__by span {
		color: var(--nj-text-muted);
	}
	.quote {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 10px 12px;
		border-left: 4px solid var(--nj-hi);
		background: var(--nj-surface);
	}
	.when {
		display: flex;
		align-items: center;
		gap: 64px;
		min-height: 80px;
		padding: 24px 0 0 22px;
		isolation: isolate;
	}
	.when__label {
		color: var(--nj-text-muted);
		font-size: 14px;
	}
	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 14px;
		margin: 0;
	}
	.facts dt {
		font: 700 11px/1.7 var(--nj-font-body);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--nj-text-muted);
	}
	.facts dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
	}
	.copied {
		display: grid;
		gap: 6px;
		margin: 0;
		font-weight: 600;
	}
	@media (min-width: 900px) {
		.lightbox {
			grid-template-columns: 1fr minmax(320px, 400px);
			grid-template-rows: 100dvh;
			overflow: hidden;
		}
		.stage {
			position: relative;
			max-height: none;
			height: 100dvh;
		}
		.stage img,
		.stage video {
			max-height: 100dvh;
		}
		.info {
			overflow-y: auto;
			border-top: 0;
			border-left: 6px solid var(--nj-accent);
			padding: 24px 28px 40px;
		}
		.step {
			width: 56px;
			height: 80px;
		}
	}
</style>
