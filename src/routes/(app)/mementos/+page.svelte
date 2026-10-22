<script lang="ts">
	import { Button, Counter, Plate, Ransom, Stamp } from '@niijima/design/svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { formatDate } from '$lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const status = $derived(data.status);
	const total = $derived(
		status ? status.migration.pending + status.migration.moved + status.migration.kept : 0
	);
	const done = $derived(status ? status.migration.moved + status.migration.kept : 0);
	const percent = $derived(total > 0 ? Math.floor((done / total) * 100) : 100);

	/* While something runs, the page checks back every few seconds. */
	$effect(() => {
		if (!status?.busy && status?.connection.state !== 'checking') return;
		const timer = setInterval(() => void invalidateAll(), 2500);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<title>Mementos · Thieves Den</title>
</svelte:head>

<header class="heading">
	<Ransom as="h1" text="MEMENTOS" animate />
	<Plate variant="paper">Where the loot is kept</Plate>
</header>

{#if form?.message}<p class="notice" role="status">{form.message}</p>{/if}

{#if !status}
	<section class="panel stack">
		<h2>On this server</h2>
		<p>
			Every file is kept on the Archive's own disk. To keep them on Mementos (your Zipline) instead,
			set <code>ZIPLINE_URL</code> and <code>ZIPLINE_TOKEN</code> in <code>.env</code> and restart the
			Archive. The README explains where the token is.
		</p>
	</section>
{:else}
	<div class="board">
		<section class="panel panel--ink stack">
			<div class="row">
				<h2>Mementos</h2>
				{#if status.connection.state === 'ok'}
					<Stamp status="online">Connected</Stamp>
				{:else if status.connection.state === 'checking'}
					<Stamp status="pending">Checking</Stamp>
				{:else}
					<Stamp status="down">Unreachable</Stamp>
				{/if}
			</div>
			<p>
				<a href={status.url} target="_blank" rel="noopener noreferrer"
					>{status.url.replace(/^https?:\/\//, '')}</a
				>
				keeps every file. The Archive keeps the captions, tags and small thumbnails{data.folder
					? `, and puts its uploads in the “${data.folder}” folder there`
					: ''}.
			</p>
			{#if status.connection.error}
				<p class="notice notice--bad">{status.connection.error}</p>
			{/if}
			<div class="counters">
				<Counter value={String(status.onZipline)} label="On Mementos" />
				{#if status.gone > 0}<Counter value={String(status.gone)} label="Deleted there" />{/if}
			</div>
		</section>

		<section class="panel stack">
			<h2>Moving old files</h2>
			<div
				class="meter"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={percent}
				aria-label="Files moved to Mementos"
			>
				<span style="width: {percent}%"></span>
			</div>
			<p class="big">
				{done} of {total} on Mementos{status.migration.pending === 0 ? ': all done.' : '.'}
			</p>
			<ul class="facts">
				<li><b>{status.migration.pending}</b> still on this server, waiting</li>
				{#if status.migration.kept > 0}
					<li>
						<b>{status.migration.kept}</b> kept here for good: Mementos stored a changed copy (it strips
						GPS data or compresses pictures), so the original never leaves
					</li>
				{/if}
				{#if status.migration.failed > 0}
					<li><b>{status.migration.failed}</b> failed for now and will be tried again</li>
				{/if}
			</ul>
			{#if status.busy === 'migrating' && status.migration.current}
				<p class="hint">Moving {status.migration.current}…</p>
			{/if}
			{#if status.migration.lastError}
				<p class="hint">Last problem: {status.migration.lastError}</p>
			{/if}
			<p class="hint">
				A file is only removed from this server after Mementos has sent back the very same bytes.
			</p>
			{#if status.migration.failed > 0}
				<form method="POST" action="?/retry" use:enhance>
					<Button type="submit" variant="hi" small>Retry failed files</Button>
				</form>
			{/if}
		</section>

		<section class="panel stack">
			<h2>Sync</h2>
			<p>
				Pictures and videos you upload to Mementos yourself (phone, ShareX, its web page) show up in
				the <a href="/collections">{data.inbox}</a> collection. Checked every {status.sync.every}
				{status.sync.every === 1 ? 'minute' : 'minutes'}.
			</p>
			{#if status.sync.progress}
				<p class="big">{status.sync.progress}</p>
			{:else if status.sync.last}
				<p class="big">
					Last synced {formatDate(status.sync.last.at, data.locale, data.timezone, true)}
				</p>
				<ul class="facts">
					<li><b>{status.sync.last.files}</b> files on Mementos</li>
					<li><b>{status.sync.last.imported}</b> new brought in</li>
					{#if status.sync.last.gone > 0}<li>
							<b>{status.sync.last.gone}</b> deleted on Mementos since the sync before
						</li>{/if}
					{#if status.sync.last.failed > 0}<li>
							<b>{status.sync.last.failed}</b> couldn't be brought in yet
						</li>{/if}
				</ul>
			{:else}
				<p class="big">Not synced yet.</p>
			{/if}
			{#if status.sync.lastError}<p class="notice notice--bad">{status.sync.lastError}</p>{/if}
			<form method="POST" action="?/sync" use:enhance>
				<Button type="submit" variant="red" disabled={status.busy !== null}
					>{status.busy ? 'Working…' : 'Sync now'}</Button
				>
			</form>
		</section>
	</div>
{/if}

<style>
	.board {
		display: grid;
		gap: 22px;
	}
	@media (min-width: 900px) {
		.board {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
		.board > :first-child {
			grid-column: 1 / -1;
		}
	}
	.panel p {
		margin: 0;
		font-weight: 500;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.panel a {
		color: inherit;
		font-weight: 700;
	}
	.panel--ink a {
		color: var(--nj-hi);
	}
	.row h2 {
		margin: 0;
	}
	.counters {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		margin-top: 6px;
	}
	.big {
		font: 400 24px/1.1 var(--nj-font-display) !important;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.meter {
		height: 18px;
		background: var(--nj-ink);
		clip-path: polygon(0 10%, 100% 0, 99% 100%, 1% 90%);
	}
	.meter span {
		display: block;
		height: 100%;
		background: var(--nj-accent);
		transition: width 0.4s var(--nj-snap);
	}
	@media (prefers-reduced-motion: reduce) {
		.meter span {
			transition: none;
		}
	}
	.facts {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-weight: 500;
	}
	.facts b {
		font: 400 20px/1 var(--nj-font-display);
		color: var(--nj-red);
	}
	code {
		font-size: 0.92em;
		font-weight: 700;
	}
</style>
