<script lang="ts">
  import { BookOpen, BrainCircuit, MessageSquarePlus, Search, X, Settings } from 'lucide-svelte'
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
    /** L1 “New” — same flow as sidebar / ⌘N (e.g. `historyNewChat`). */
    onNewChat?: () => void
    /** When true, new-chat is disabled (already on idle `/c` with nothing in the bar — ⌘N is a no-op). */
    isEmptyChat?: boolean
    /**
     * Hosted only: `@handle` next to Hub after onboarding confirmation.
     * Omitted in the top bar on narrow viewports; use the top Settings control instead.
     */
    hostedHandlePill?: string
    /** Hosted and desktop: opens Settings (`/settings`). */
    onOpenSettings?: () => void
    /** Wiki vault root (`index.md` / resolved landing) — optional; hidden when omitted (e.g. onboarding). */
    onWikiHome?: () => void
  }

  let {
    showChatHistoryButton = true,
    sidebarOpen = false,
    isMobile = false,
    onToggleSidebar,
    syncErrors,
    showSyncErrors,
    onOpenSearch,
    onToggleSyncErrors,
    onOpenHub,
    onNewChat,
    isEmptyChat = false,
    hostedHandlePill,
    onOpenSettings,
    onWikiHome,
  }: Props = $props()

  /** Sidebar open (wide header + list): desktop or mobile. */
  const navOpen = $derived(sidebarOpen)
  /** Center title only when there is no left nav (e.g. onboarding); otherwise title lives in the sidebar control. */
  const showCenterBrand = $derived(!showChatHistoryButton)
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
          <span class="nav-brand-title">Braintunnel</span>
        </button>
      {/if}
    </div>
  {/if}
  <div class="brand" class:brand--silent={!showCenterBrand}>
    {#if showCenterBrand}
      <span class="brand-name">Braintunnel</span>
    {/if}
  </div>
  <div class="nav-actions" aria-label="Top actions">
    <div class="search-wrap">
        <button class="search-btn" onclick={onOpenSearch} title="Search (⌘K)" aria-label="Search">
        <Search size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
    {#if onWikiHome}
      <div class="wiki-home-wrap">
        <button
          type="button"
          class="wiki-home-btn"
          class:wiki-home-btn--labeled={!isMobile}
          onclick={onWikiHome}
          title="Wiki home (⌘⇧H)"
          aria-label={isMobile ? 'Wiki home' : undefined}
        >
          <BookOpen size={15} strokeWidth={2} aria-hidden="true" />
          {#if !isMobile}<span class="nav-action-label">Wiki</span>{/if}
        </button>
      </div>
    {/if}
    {#if onNewChat}
      <div class="new-wrap">
        <button
          type="button"
          class="new-nav-btn"
          class:new-nav-btn--labeled={!isMobile}
          disabled={isEmptyChat}
          onclick={onNewChat}
          title={isEmptyChat ? 'Already in new chat' : 'New chat (⌘N)'}
          aria-label={isEmptyChat ? 'New conversation (already empty)' : isMobile ? 'New conversation' : undefined}
        >
          <MessageSquarePlus size={15} strokeWidth={2.25} aria-hidden="true" />
          {#if !isMobile}<span class="nav-action-label">Chat</span>{/if}
        </button>
      </div>
    {/if}
    {#if onOpenSettings && (isMobile || !hostedHandlePill)}
      <div class="settings-wrap">
        <button
          type="button"
          class="settings-nav-btn"
          class:settings-nav-btn--labeled={!isMobile}
          onclick={onOpenSettings}
          title="Settings"
          aria-label={isMobile ? 'Settings' : undefined}
        >
          <Settings size={15} strokeWidth={2} aria-hidden="true" />
          {#if !isMobile}<span class="nav-action-label">Settings</span>{/if}
        </button>
      </div>
    {/if}
    <div class="sync-wrap">
      {#if hostedHandlePill && onOpenSettings && !isMobile}
        <button
          type="button"
          class="nav-hosted-handle"
          onclick={onOpenSettings}
          title="Workspace settings"
        >
          @{hostedHandlePill}
        </button>
      {/if}
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

  @media (max-width: 767px) {
    .nav-left--wide {
      width: var(--sidebar-history-mobile-w);
      min-width: var(--sidebar-history-mobile-w);
    }
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

  .menu-btn {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
    height: 100%;
    min-height: var(--tab-h);
    padding: 0 4px 0 2px;
    color: var(--text-2);
    transition: color 0.15s;
  }
  .menu-btn :global(svg) {
    flex-shrink: 0;
  }
  .menu-btn .nav-brand-title {
    min-width: 0;
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

  .nav-actions {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    gap: 2px;
    padding-left: 8px;
  }

  .new-wrap {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .new-nav-btn {
    width: 40px;
    height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    min-width: 40px;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-2);
    flex-shrink: 0;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .new-nav-btn--labeled {
    gap: 6px;
    width: auto;
    min-width: 40px;
    padding: 0 10px;
  }

  .nav-action-label {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .wiki-home-btn .nav-action-label,
  .new-nav-btn .nav-action-label {
    color: inherit;
  }

  .new-nav-btn :global(svg) {
    flex-shrink: 0;
    color: currentColor;
  }

  .new-nav-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .new-nav-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .search-wrap {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .wiki-home-wrap {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .settings-wrap {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .settings-nav-btn {
    width: 40px;
    height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 0;
    box-sizing: border-box;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .settings-nav-btn--labeled {
    gap: 6px;
    width: auto;
    min-width: 40px;
    padding: 0 10px;
  }

  .settings-nav-btn:hover {
    color: var(--text);
    background: var(--bg-3);
  }

  .settings-nav-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .wiki-home-btn {
    width: 40px;
    height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 0;
    box-sizing: border-box;
    color: var(--text-2);
    transition: color 0.15s;
  }

  .wiki-home-btn--labeled {
    gap: 6px;
    width: auto;
    min-width: 40px;
    padding: 0 10px;
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

  .sync-wrap {
    position: relative;
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
  }

  .nav-hosted-handle {
    align-self: center;
    margin: 0 6px 0 8px;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
    font-weight: 500;
    color: var(--text-2);
    background: transparent;
    border: none;
    cursor: pointer;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  @media (hover: hover) {
    .nav-sidebar-close:hover {
      color: var(--text);
      background: var(--bg-3);
    }
    .menu-btn:hover {
      color: var(--text);
    }
    .search-btn:hover,
    .wiki-home-btn:hover,
    .settings-nav-btn:hover,
    .new-nav-btn:hover:not(:disabled) {
      color: var(--text);
      background: var(--bg-3);
    }
    .nav-hosted-handle:hover {
      color: var(--text);
      background: var(--bg-3);
    }
    .sync-error-badge:hover {
      background: #c0392b;
    }
  }

  /* Mobile: larger tab strip + 18px type to match left-rail list (see ChatHistory @ 768px) */
  @media (max-width: 768px) {
    .nav-brand-title,
    .brand-name {
      font-size: 18px;
    }

    .search-btn :global(svg),
    .wiki-home-btn :global(svg),
    .settings-nav-btn :global(svg),
    .new-nav-btn :global(svg) {
      width: 18px;
      height: 18px;
    }

    .new-nav-btn:not(.new-nav-btn--labeled) {
      width: 40px;
      min-width: 40px;
      height: 36px;
      min-height: 36px;
    }

    .nav-sidebar-close {
      width: 40px;
      height: 40px;
    }

    .menu-btn :global(svg),
    .nav-brand-lockup :global(svg),
    .nav-sidebar-close :global(svg) {
      width: 20px;
      height: 20px;
    }

    .sync-wrap :global(.hub-widget) {
      font-size: 18px;
    }

    .sync-wrap :global(.wiki-page-count-indicator) {
      font-size: 18px;
    }

    .sync-wrap :global(.pulse-container) {
      width: 16px;
      height: 16px;
    }

    .sync-wrap :global(.pulse-dot) {
      width: 9px;
      height: 9px;
    }

    .sync-wrap :global(svg.wpc-book) {
      width: 18px;
      height: 18px;
    }
  }

</style>
