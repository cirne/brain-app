<script lang="ts">
  import Wiki from './Wiki.svelte'
  import Inbox from './Inbox.svelte'
  import Calendar from './Calendar.svelte'
  import type { Overlay } from '../router.js'
  import type { SurfaceContext } from '../router.js'

  type Props = {
    overlay: Overlay
    wikiRefreshKey: number
    calendarRefreshKey: number
    inboxTargetId: string | undefined
    onWikiNavigate: (_path: string | undefined) => void
    onInboxNavigate: (_id: string | undefined) => void
    onContextChange: (_ctx: SurfaceContext) => void
    onOpenSearch?: () => void
    onSummarizeInbox?: (_message: string) => void
    onClose: () => void
  }

  let {
    overlay,
    wikiRefreshKey,
    calendarRefreshKey,
    inboxTargetId,
    onWikiNavigate,
    onInboxNavigate,
    onContextChange,
    onOpenSearch,
    onSummarizeInbox,
    onClose,
  }: Props = $props()

  function titleForOverlay(o: Overlay): string {
    if (o.type === 'wiki') return 'Wiki'
    if (o.type === 'email') return 'Inbox'
    return 'Calendar'
  }
</script>

<div class="slide-over" data-overlay={overlay.type}>
  <header class="slide-header">
    <button type="button" class="back-btn" onclick={onClose} aria-label="Back to chat">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m15 18-6-6 6-6"/>
      </svg>
      <span>Chat</span>
    </button>
    <span class="slide-title">{titleForOverlay(overlay)}</span>
  </header>
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

  .slide-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
    min-height: 40px;
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

  .slide-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

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
