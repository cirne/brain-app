<script lang="ts">
  import Chat from './lib/Chat.svelte'
  import Wiki from './lib/Wiki.svelte'
  import Inbox from './lib/Inbox.svelte'

  type Tab = 'chat' | 'wiki' | 'inbox'
  let active = $state<Tab>('chat')
</script>

<div class="app">
  <nav class="tabs">
    <button class:active={active === 'chat'} onclick={() => active = 'chat'}>Chat</button>
    <button class:active={active === 'wiki'} onclick={() => active = 'wiki'}>Wiki</button>
    <button class:active={active === 'inbox'} onclick={() => active = 'inbox'}>Inbox</button>
  </nav>

  <main class="surface">
    {#if active === 'chat'}
      <Chat />
    {:else if active === 'wiki'}
      <Wiki />
    {:else}
      <Inbox />
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
  }
</style>
