<script lang="ts">
  import { BrainCircuit, X } from 'lucide-svelte'
  import BrainHubWidget from './BrainHubWidget.svelte'

  type Props = {
    /** When false, hides the chat history control (e.g. onboarding uses the same top bar without history). */
    showChatHistoryButton?: boolean
    /** Whether the history sidebar is open (desktop or mobile). */
    sidebarOpen?: boolean
    isMobile?: boolean
    onToggleSidebar: () => void
    syncErrors: string[]
    showSyncErrors: boolean
    onOpenSearch: () => void
    onToggleSyncErrors: () => void
    onOpenHub: () => void
  }

  let {
    showChatHistoryButton = true,
    sidebarOpen = false,
    isMobile: _isMobile = false,
    onToggleSidebar,
    syncErrors,
    showSyncErrors,
    onOpenSearch,
    onToggleSyncErrors,
    onOpenHub,
  }: Props = $props()

  /** Sidebar open (wide header + list): desktop or mobile. */
  const navOpen = $derived(sidebarOpen)
  /** Center title only when nav is collapsed. */
  const showCenterBrand = $derived(!showChatHistoryButton || !navOpen)
</script>

<nav class="tabs">
  {#if showChatHistoryButton}
    <div class="nav-left" class:nav-left--wide={navOpen} class:nav-left--collapsed={!navOpen}>
      {#if navOpen}
        <div class="nav-brand-lockup">
          <BrainCircuit size={18} strokeWidth={2} aria-hidden="true" />
          <span class="nav-brand-title">Braintunnel</span>
        </div>
        <button
          type="button"
          class="nav-sidebar-close"
          onclick={onToggleSidebar}
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      {:else}
        <button
          class="menu-btn"
          type="button"
          onclick={onToggleSidebar}
          title="Open sidebar"
          aria-label="Open sidebar"
        >
          <BrainCircuit size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      {/if}
    </div>
  {/if}
  <div class="brand" class:brand--silent={!showCenterBrand}>
    {#if showCenterBrand}
      <span class="brand-name">Braintunnel</span>
    {/if}
  </div>
  <div class="search-wrap">
    <button class="search-btn" onclick={onOpenSearch} title="Search (⌘K)" aria-label="Search">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
    </button>
  </div>
  <div class="sync-wrap">
    <BrainHubWidget onOpen={onOpenHub} />
    {#if syncErrors.length > 0}
      <button class="sync-error-badge" onclick={onToggleSyncErrors} title="Show sync errors">!</button>
      {#if showSyncErrors}
        <div class="sync-error-popup">
          <div class="sync-error-title">Sync errors</div>
          {#each syncErrors as err}
            <div class="sync-error-item">{err}</div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</nav>

<style>
  .tabs {
    display: flex;
    align-items: stretch;
    height: var(--tab-h);
    border-bottom: 1px solid var(--border);
    background-color: var(--bg-2);
    background-image: none;
    flex-shrink: 0;
  }

  .nav-left {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 100%;
    padding: 0 10px;
    box-sizing: border-box;
    background-color: var(--bg-2);
    background-image: none;
  }

  .nav-left--wide {
    width: var(--sidebar-history-w);
    min-width: var(--sidebar-history-w);
  }

  .nav-left--collapsed {
    width: auto;
    min-width: 40px;
    padding: 0 6px;
  }

  .nav-brand-lockup {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--text);
  }

  .nav-brand-lockup :global(svg) {
    flex-shrink: 0;
    color: var(--text-2);
  }

  .nav-brand-title {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-sidebar-close {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 6px;
    color: var(--text-2);
    transition: color 0.15s, background 0.15s;
  }
  .nav-sidebar-close:hover {
    color: var(--text);
    background: var(--bg-3);
  }

  .menu-btn {
    width: 40px;
    height: 100%;
    min-height: var(--tab-h);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    transition: color 0.15s;
    margin: 0 -6px;
  }
  .menu-btn:hover {
    color: var(--text);
  }

  .brand {
    display: flex;
    align-items: center;
    padding: 0 14px;
    flex: 1;
    min-width: 0;
  }

  .brand--silent {
    pointer-events: none;
  }

  .brand-name {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text);
  }

  .search-wrap {
    display: flex;
    align-items: center;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-btn {
    width: 40px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    transition: color 0.15s;
  }
  .search-btn:hover { color: var(--text); }

  .sync-wrap {
    position: relative;
    display: flex;
    align-items: stretch;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }

  .sync-error-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #e74c3c;
    color: white;
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    cursor: pointer;
  }
  .sync-error-badge:hover { background: #c0392b; }

  .sync-error-popup {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 220px;
    background: var(--bg-3);
    border: 1px solid #e74c3c;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 200;
    overflow: hidden;
  }

  .sync-error-title {
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 600;
    color: #e74c3c;
    border-bottom: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .sync-error-item {
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text);
    font-family: monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }

</style>
