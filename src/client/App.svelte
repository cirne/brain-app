<script lang="ts">
  import { onMount } from 'svelte'
  import Chat from './lib/Chat.svelte'
  import Wiki from './lib/Wiki.svelte'
  import Inbox from './lib/Inbox.svelte'
  import { parseRoute, navigate, type Route } from './router.js'

  let route = $state<Route>(parseRoute())

  onMount(() => {
    const onPopState = () => { route = parseRoute() }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })

  function switchTab(tab: Route['tab']) {
    const next: Route = { tab }
    navigate(next)
    route = next
  }

  function chatAboutFile(path: string, message?: string) {
    const next: Route = { tab: 'chat', file: path, message }
    navigate(next)
    route = next
  }

  function onWikiNavigate(path: string | undefined) {
    route = { tab: 'wiki', path }
  }

  function onInboxNavigate(id: string | undefined) {
    route = { tab: 'inbox', id }
  }
</script>

<div class="app">
  <nav class="tabs">
    <button class:active={route.tab === 'chat'} onclick={() => switchTab('chat')}>Chat</button>
    <button class:active={route.tab === 'wiki'} onclick={() => switchTab('wiki')}>Wiki</button>
    <button class:active={route.tab === 'inbox'} onclick={() => switchTab('inbox')}>Inbox</button>
  </nav>

  <main class="surface">
    {#if route.tab === 'chat'}
      <Chat contextFiles={route.file ? [route.file] : []} initialMessage={route.message} onSwitchToWiki={chatAboutFile} />
    {:else if route.tab === 'wiki'}
      <Wiki
        initialPath={route.path}
        onChatAbout={chatAboutFile}
        onNavigate={onWikiNavigate}
      />
    {:else}
      <Inbox
        initialId={route.id}
        onNavigate={onInboxNavigate}
      />
    {/if}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .tabs {
    display: flex;
    height: var(--tab-h);
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .tabs button {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-2);
    letter-spacing: 0.02em;
    transition: color 0.15s;
  }

  .tabs button:hover {
    color: var(--text);
  }

  .tabs button.active {
    color: var(--accent);
    border-bottom: 2px solid var(--accent);
  }

  .surface {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
</style>
