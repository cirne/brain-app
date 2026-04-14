<script lang="ts">
  import { Mail } from 'lucide-svelte'
  import Wiki from './Wiki.svelte'
  import Inbox from './Inbox.svelte'
  import Calendar from './Calendar.svelte'
  import WikiFileName from './WikiFileName.svelte'
  import PaneL2Header from './PaneL2Header.svelte'
  import type { Overlay } from '../router.js'
  import type { SurfaceContext } from '../router.js'

  type Props = {
    overlay: Overlay
    /** From App — used for email subject in header when a thread is open. */
    surfaceContext?: SurfaceContext
    wikiRefreshKey: number
    calendarRefreshKey: number
    inboxTargetId: string | undefined
    onWikiNavigate: (_path: string | undefined) => void
    onInboxNavigate: (_id: string | undefined) => void
    onContextChange: (_ctx: SurfaceContext) => void
    onOpenSearch?: () => void
    onSummarizeInbox?: (_message: string) => void
    onClose: () => void
    onSync?: () => void
    syncing?: boolean
  }

  let {
    overlay,
    surfaceContext = { type: 'chat' } as SurfaceContext,
    wikiRefreshKey,
    calendarRefreshKey,
    inboxTargetId,
    onWikiNavigate,
    onInboxNavigate,
    onContextChange,
    onOpenSearch,
    onSummarizeInbox,
    onClose,
    onSync,
    syncing = false,
  }: Props = $props()

  const emailHeaderTitle = $derived.by((): string | null => {
    if (overlay.type !== 'email' || !overlay.id) return null
    if (surfaceContext.type !== 'email') return null
    if (surfaceContext.threadId !== overlay.id) return null
    const s = surfaceContext.subject?.trim()
    if (!s || s === '(loading)') return null
    return s
  })

  function titleForOverlay(o: Overlay): string {
    if (o.type === 'wiki') return 'Wiki'
    if (o.type === 'email') return 'Inbox'
    return 'Calendar'
  }
</script>

<div class="slide-over" data-overlay={overlay.type}>
  <PaneL2Header>
    {#snippet left()}
      <button type="button" class="back-btn" onclick={onClose} aria-label="Back to chat">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 18-6-6 6-6"/>
        </svg>
        <span>Chat</span>
      </button>
    {/snippet}
    {#snippet center()}
      <span
        class="slide-title"
        class:slide-title-wiki={Boolean(
          (overlay.type === 'wiki' && overlay.path) || (overlay.type === 'email' && emailHeaderTitle),
        )}
      >
        {#if overlay.type === 'wiki' && overlay.path}
          <WikiFileName path={overlay.path} />
        {:else if overlay.type === 'email' && emailHeaderTitle}
          <span class="slide-title-email">
            <Mail size={14} strokeWidth={2} aria-hidden="true" />
            <span class="slide-title-email-text">{emailHeaderTitle}</span>
          </span>
        {:else}
          {titleForOverlay(overlay)}
        {/if}
      </span>
    {/snippet}
    {#snippet right()}
      {#if onSync}
        <div class="slide-actions">
          {#if onOpenSearch}
            <button class="slide-action-btn" onclick={onOpenSearch} title="Search (⌘K)" aria-label="Search">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </button>
          {/if}
          <button class="slide-action-btn" onclick={onSync} disabled={syncing} title="Sync (⌘R)" aria-label="Sync">
            <svg class:spinning={syncing} xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
              <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
          </button>
        </div>
      {/if}
      <button type="button" class="close-btn-desktop" onclick={onClose} aria-label="Close panel" title="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
      </button>
    {/snippet}
  </PaneL2Header>
  <div class="slide-body">
    {#if overlay.type === 'wiki'}
      <Wiki
        initialPath={overlay.path}
        refreshKey={wikiRefreshKey}
        onNavigate={(path) => onWikiNavigate(path)}
        onContextChange={onContextChange}
      />
    {:else if overlay.type === 'email'}
      <Inbox
        initialId={overlay.id}
        targetId={inboxTargetId}
        onNavigate={onInboxNavigate}
        onContextChange={onContextChange}
        onOpenSearch={onOpenSearch}
        onSummarizeInbox={onSummarizeInbox}
      />
    {:else}
      <Calendar
        refreshKey={calendarRefreshKey}
        initialDate={overlay.date}
        onContextChange={onContextChange}
      />
    {/if}
  </div>
</div>

<style>
  .slide-over {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    border-left: 1px solid var(--border);
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--accent);
    padding: 4px 8px;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .back-btn:hover {
    background: var(--accent-dim);
  }

  .close-btn-desktop {
    display: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    color: var(--text-2);
    border: none;
    border-radius: 6px;
    background: transparent;
    transition: color 0.15s;
  }
  .close-btn-desktop:hover {
    color: var(--text);
  }

  @media (min-width: 768px) {
    .back-btn {
      display: none;
    }
    .close-btn-desktop {
      display: inline-flex;
    }
  }

  .slide-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
    min-width: 0;
  }

  .slide-title.slide-title-wiki {
    text-transform: none;
    letter-spacing: normal;
    font-weight: normal;
  }

  .slide-title.slide-title-wiki :global(.wfn-title-row) {
    font-size: 13px;
    color: var(--text);
  }

  .slide-title-email {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .slide-title-email :global(svg) {
    flex-shrink: 0;
    color: var(--text-2);
  }
  .slide-title-email-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slide-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .slide-action-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
  }
  .slide-action-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-3); }
  .slide-action-btn:disabled { opacity: 0.5; cursor: default; }

  .slide-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .slide-body :global(.wiki),
  .slide-body :global(.inbox),
  .slide-body :global(.calendar) {
    flex: 1;
    min-height: 0;
  }
</style>
