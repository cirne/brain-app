<script lang="ts">
  import { BrainCircuit } from 'lucide-svelte'
  import WikiFileList from './WikiFileList.svelte'

  type Props = {
    onToggleSidebar: () => void
    dirtyFiles: string[]
    recentFiles: { path: string; date: string }[]
    showRecentFiles: boolean
    syncing: boolean
    syncErrors: string[]
    showSyncErrors: boolean
    onOpenSearch: () => void
    onToggleRecentFiles: () => void
    onOpenWikiFromList: (_path: string) => void
    onSync: () => void
    onToggleSyncErrors: () => void
    onReRunOnboarding?: () => void | Promise<void>
  }

  let {
    onToggleSidebar,
    dirtyFiles,
    recentFiles,
    showRecentFiles,
    syncing,
    syncErrors,
    showSyncErrors,
    onOpenSearch,
    onToggleRecentFiles,
    onOpenWikiFromList,
    onSync,
    onToggleSyncErrors,
    onReRunOnboarding,
  }: Props = $props()
</script>

<nav class="tabs">
  <div class="menu-wrap">
    <button
      class="menu-btn"
      type="button"
      onclick={onToggleSidebar}
      title="Chat history"
      aria-label="Open chat history"
    >
      <BrainCircuit size={18} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>
  <div class="brand">
    <span class="brand-name">Brain</span>
  </div>
  {#if onReRunOnboarding}
    <div class="onboarding-wrap">
      <button
        class="onboarding-btn"
        type="button"
        onclick={() => void onReRunOnboarding?.()}
        title="Re-run onboarding wizard"
      >
        Setup
      </button>
    </div>
  {/if}
  <div class="search-wrap">
    <button class="search-btn" onclick={onOpenSearch} title="Search (⌘K)" aria-label="Search">
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
    </button>
  </div>
  {#if dirtyFiles.length > 0}
    <div class="log-wrap">
      <button
        class="log-btn"
        onclick={onToggleRecentFiles}
        title="Unsynced docs"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="dirty-badge" title="{dirtyFiles.length} unsaved file{dirtyFiles.length === 1 ? '' : 's'}">{dirtyFiles.length}</span>
      </button>
      {#if showRecentFiles}
        <div class="log-dropdown" role="menu">
          <WikiFileList
            dirty={dirtyFiles}
            recent={recentFiles}
            showRecent={false}
            onOpen={(path) => { onOpenWikiFromList(path) }}
          />
        </div>
      {/if}
    </div>
  {/if}
  <div class="sync-wrap">
    <button
      class="sync-btn sync-press-when-syncing"
      class:syncing={syncing}
      onclick={onSync}
      disabled={syncing}
      title="Sync docs, email, and calendar (⌘R)"
    >
      <svg
        class:sync-spinning={syncing}
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
        <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
      </svg>
    </button>
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
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .menu-wrap {
    display: flex;
    align-items: center;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
  }

  .menu-btn {
    width: 40px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    transition: color 0.15s;
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

  .brand-name {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text);
  }

  .onboarding-wrap {
    display: flex;
    align-items: center;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }

  .onboarding-btn {
    padding: 0 10px;
    height: 100%;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
  }
  .onboarding-btn:hover {
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

  .log-wrap {
    position: relative;
    display: flex;
    align-items: center;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }

  .log-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
  }
  .log-btn svg { flex-shrink: 0; }

  .dirty-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: #e8a020;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  }

  .log-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 260px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 200;
  }

  .sync-wrap {
    position: relative;
    display: flex;
    align-items: center;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }
  .log-wrap + .sync-wrap {
    border-left: none;
  }

  .log-btn, .sync-btn {
    color: var(--text-2);
    transition: color 0.15s;
    height: 100%;
  }
  .log-btn:hover, .sync-btn:hover:not(:disabled) { color: var(--text); }

  .sync-btn {
    width: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sync-btn:disabled { opacity: 0.5; cursor: default; }
  .sync-btn svg { display: block; }

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
