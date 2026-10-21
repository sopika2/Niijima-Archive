<script lang="ts">
	import { Bands, Button, Ransom, Speech, Wordmark } from '@niijima/design/svelte';
	import HostArt from '$lib/components/HostArt.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const messages: Record<string, string> = {
		signed_out: "You're signed out. The Den stays locked until you're back.",
		expired: 'That sign-in took too long. Try once more.',
		failed: "Discord didn't answer properly. Try again in a moment.",
		refused: "This Discord account isn't on the list for the Den."
	};

	const href = $derived(
		data.next === '/' ? '/auth/login' : `/auth/login?next=${encodeURIComponent(data.next)}`
	);

	let copied = $state(false);
	async function copyId() {
		if (!data.refusedId) return;
		try {
			await navigator.clipboard.writeText(data.refusedId);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in · Thieves Den</title>
</svelte:head>

<main class="signin">
	<Bands ghost="DEN" />
	<div class="body">
		<Wordmark name="Niijima Archive" />
		<Ransom as="h1" text="THIEVES DEN" size="clamp(44px, 11vw, 104px)" animate />
		<div class="host">
			<HostArt art={data.host.art} name={data.host.name} size={120} />
			<Speech tag={{ number: data.host.name.toUpperCase(), word: 'Thieves Den' }}>
				<p class="line">Show me your calling card first. Then the Den is yours.</p>
				{#if data.message}
					<p class="message" role={data.message === 'refused' ? 'alert' : 'status'}>
						{messages[data.message]}
					</p>
				{/if}
				{#if data.refusedId}
					<p class="help">Add this id to <code>access.discord_user_ids</code> in config.yml:</p>
					<button type="button" class="id" onclick={copyId}>
						<code>{data.refusedId}</code>
						<span>{copied ? 'Copied' : 'Copy'}</span>
					</button>
				{/if}
				<div class="go"><Button {href} variant="red">Sign in with Discord</Button></div>
			</Speech>
		</div>
	</div>
</main>

<style>
	.signin {
		position: relative;
		isolation: isolate;
		display: grid;
		align-items: center;
		min-height: 100dvh;
		overflow: hidden;
		padding: 32px clamp(16px, 6vw, 96px);
		background: var(--nj-field);
	}
	.body {
		display: grid;
		justify-items: start;
		gap: 28px;
		width: min(100%, 720px);
	}
	.host {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		width: 100%;
		margin-top: 40px;
	}
	.host :global(.nj-speech) {
		flex: 1;
		min-width: 0;
	}
	.line {
		margin: 0 0 14px;
		font: 700 18px/1.4 var(--nj-font-body);
	}
	.message {
		margin: 0 0 14px;
		padding: 8px 12px;
		background: var(--nj-ink);
		color: var(--nj-paper);
		font-weight: 600;
	}
	.go {
		margin-top: 4px;
	}
	.help {
		margin: 0 0 6px;
		font-size: 15px;
	}
	.id {
		display: inline-flex;
		gap: 10px;
		align-items: center;
		min-height: 44px;
		margin-bottom: 18px;
		padding: 6px 12px;
		border: 2px dashed currentColor;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	@media (max-width: 600px) {
		.host {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
