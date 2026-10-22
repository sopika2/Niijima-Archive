<script lang="ts">
	import { PersonaSwitch } from '@niijima/design/svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const nav = [
		{ href: '/', label: 'Den', hint: 'Everything stolen' },
		{ href: '/add', label: 'Steal', hint: 'Save a tweet or pictures' },
		{ href: '/collections', label: 'Collections', hint: 'Showcases' }
	] as const;
	const active = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<div class="shell">
	<header class="top">
		<a class="mark" href="/" aria-label="Thieves Den, home">
			<span class="mark__name">Thieves Den</span><small>新島アーカイブ</small>
		</a>
		<div class="top__right">
			<PersonaSwitch value={data.persona} onchange={() => invalidateAll()} />
		</div>
		<nav class="tabs" aria-label="Main">
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="tab"
					aria-current={active(item.href) ? 'page' : undefined}
					title={item.hint}>{item.label}</a
				>
			{/each}
			{#if data.signedIn}
				<form method="POST" action="/auth/logout" class="out-form">
					<button class="out" type="submit" title="Sign out on this device">Out</button>
				</form>
			{/if}
		</nav>
	</header>

	<main class="page">
		{@render children()}
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
	}
	.top {
		position: relative;
		z-index: 5;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 14px 12px;
		padding: 18px var(--gutter) 10px;
	}
	.mark {
		justify-self: start;
		display: inline-flex;
		align-items: baseline;
		gap: 10px;
		padding: 9px 14px 7px;
		background: var(--nj-ink);
		color: var(--nj-paper);
		box-shadow: 5px 5px 0 var(--nj-paper);
		text-decoration: none;
		transform: rotate(-4deg);
		white-space: nowrap;
	}
	.mark__name {
		font: 400 21px/1 var(--nj-font-display);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.mark small {
		color: var(--nj-paper-muted);
		font: 700 11px/1 var(--nj-font-body);
		letter-spacing: 0.14em;
	}
	.top__right {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.top__right :global(.nj-persona__opt) {
		min-height: 36px;
		padding: 9px 12px 6px;
	}
	.out-form {
		margin-left: auto;
		align-self: center;
	}
	.out {
		min-height: 44px;
		padding: 6px 10px 4px;
		border: 2px solid var(--nj-paper-muted);
		background: none;
		color: var(--nj-paper-muted);
		font: 400 14px/1 var(--nj-font-display);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transform: rotate(-3deg);
	}
	.out:hover {
		color: var(--nj-paper);
		border-color: var(--nj-paper);
	}
	.tabs {
		grid-column: 1 / -1;
		display: flex;
		gap: 6px;
		margin-top: 4px;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 8px 16px 5px;
		background: var(--nj-ink);
		color: var(--nj-paper);
		font: 400 20px/1 var(--nj-font-display);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		text-decoration: none;
		clip-path: polygon(4% 0, 100% 6%, 96% 100%, 0 92%);
		transform: rotate(-2deg);
		transition:
			transform var(--nj-fast) var(--nj-snap),
			background-color 0.06s;
	}
	.tab:hover {
		transform: rotate(-2deg) scale(1.05);
	}
	.tab[aria-current='page'] {
		background: var(--nj-paper);
		color: var(--nj-ink);
		box-shadow: inset 0 -5px 0 var(--nj-accent);
	}
	.page {
		padding: 10px var(--gutter) 96px;
	}
	@media (min-width: 900px) {
		.top {
			grid-template-columns: auto 1fr auto;
			padding-top: 24px;
		}
		.tabs {
			grid-column: 2;
			grid-row: 1;
			margin: 0 0 0 24px;
		}
		.tab {
			font-size: 22px;
			padding-inline: 20px;
		}
	}
	@media (max-width: 520px) {
		.mark {
			gap: 0;
			padding: 8px 11px 6px;
		}
		.mark__name {
			font-size: 18px;
			letter-spacing: 0.08em;
		}
		.mark small {
			display: none;
		}
		.top__right {
			gap: 6px;
		}
		.tab {
			padding-inline: 13px;
			font-size: 19px;
		}
	}
</style>
