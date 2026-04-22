<script lang="ts">
  import { onMount, getContext } from 'svelte'
  import { Sparkles, Pause, Play, RefreshCw } from 'lucide-svelte'
  import type { BackgroundAgentDoc, YourWikiPhase } from './statusBar/backgroundAgentTypes.js'
  import BackgroundAgentPanel from './statusBar/BackgroundAgentPanel.svelte'
  import { YOUR_WIKI_HEADER, type RegisterYourWikiHeader } from './yourWikiHeaderContext.js'
  import { yourWikiDocFromEvents } from './hubEvents/hubEventsStores.js'

  type Props = {
    onOpenWiki: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_chat: string, _label: string) => void
  }

  let {
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
  }: Props = $props()

  let doc = $state<BackgroundAgentDoc | null>(null)
  let actionBusy = $state(false)
  let detailScrollRoot = $state<HTMLElement | undefined>(undefined)

  const phase = $derived(doc?.phase as YourWikiPhase | undefined)
  const isActive = $derived(phase === 'starting' || phase === 'enriching' || phase === 'cleaning')
  const isIdle = $derived(phase === 'idle' || (!isActive && phase !== 'paused' && phase !== 'error'))
  const isPaused = $derived(phase === 'paused')

  function phaseDescription(p: YourWikiPhase | undefined): string {
    if (!p || p === 'idle') return 'Up to date — waiting for new mail sync or a manual nudge.'
    if (p === 'starting') return 'Building your first wiki pages from your profile and indexed mail…'
    if (p === 'enriching') return 'Enriching pages — adding new content, cross-links, and public context.'
    if (p === 'cleaning') return 'Cleaning up — fixing broken links, orphans, and index.'
    if (p === 'paused') return 'The wiki loop is paused. Resume to continue enriching and cleaning up.'
    if (p === 'error') return 'Something went wrong. Resume to retry.'
    return ''
  }

  async function pause() {
    if (actionBusy) return
    actionBusy = true
    try {
      await fetch('/api/your-wiki/pause', { method: 'POST' })
    } finally {
      actionBusy = false
    }
  }

  async function resume() {
    if (actionBusy) return
    actionBusy = true
    try {
      await fetch('/api/your-wiki/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      })
    } finally {
      actionBusy = false
    }
  }

  async function runLap() {
    if (actionBusy) return
    actionBusy = true
    try {
      await fetch('/api/your-wiki/run-lap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      })
    } finally {
      actionBusy = false
    }
  }

  onMount(() => {
    return yourWikiDocFromEvents.subscribe((d) => {
      if (d) doc = d
    })
  })

  const registerHeader = getContext<RegisterYourWikiHeader>(YOUR_WIKI_HEADER)
  $effect(() => {
    registerHeader({
      doc,
      actionBusy,
      pause,
      resume,
    })
    return () => registerHeader(null)
  })
</script>

<div class="your-wiki-detail" bind:this={detailScrollRoot}>
  <p class="section-lead">
    Your Wiki improves continuously while Braintunnel is running — enriching pages from your mail and profile,
    then cleaning up links and structure. Pause it any time; resume starts a fresh lap.
  </p>

  {#if doc}
    <div class="status-row">
      <div class="status-info">
        <span class="phase-pill" class:active={isActive} class:paused={isPaused} class:idle={isIdle}>
          {phase === 'starting' ? 'Starting' :
           phase === 'enriching' ? 'Enriching' :
           phase === 'cleaning' ? 'Cleaning up' :
           phase === 'paused' ? 'Paused' :
           phase === 'error' ? 'Error' :
           'Idle'}
        </span>
        {#if doc.pageCount > 0}
          <span class="page-count">{doc.pageCount} pages</span>
        {/if}
      </div>
      <div class="actions">
        {#if isActive || (isIdle && !isPaused)}
          <button
            type="button"
            class="action-btn action-btn-secondary"
            disabled={actionBusy}
            onclick={pause}
            title="Pause the wiki loop"
          >
            <Pause size={14} aria-hidden="true" />
            Pause
          </button>
        {:else if isPaused || phase === 'error'}
          <button
            type="button"
            class="action-btn action-btn-primary"
            disabled={actionBusy}
            onclick={resume}
            title="Resume the wiki loop (starts a new lap)"
          >
            <Play size={14} aria-hidden="true" />
            Resume
          </button>
        {/if}
        {#if isIdle && !isPaused}
          <button
            type="button"
            class="action-btn action-btn-ghost"
            disabled={actionBusy}
            onclick={runLap}
            title="Start a lap now"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Run a lap now
          </button>
        {/if}
      </div>
    </div>

    <p class="phase-description">
      {phaseDescription(phase)}
    </p>
  {:else}
    <p class="phase-description">Loading…</p>
  {/if}

  <div class="activity-section">
    <div class="activity-label">
      <Sparkles size={14} aria-hidden="true" />
      Activity
    </div>
    <BackgroundAgentPanel
      embedInHubDetail
      embedScrollParent={detailScrollRoot}
      {onOpenWiki}
      {onOpenFile}
      {onOpenEmail}
      {onOpenFullInbox}
      {onSwitchToCalendar}
      {onOpenMessageThread}
    />
  </div>
</div>

<style>
  .your-wiki-detail {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1rem 1.25rem 1.5rem;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }

  .section-lead {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    line-height: 1.45;
    max-width: 40rem;
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .status-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .phase-pill {
    font-size: 0.625rem;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--bg-3);
    color: var(--text-2);
  }

  .phase-pill.active {
    background: var(--accent);
    color: white;
  }

  .phase-pill.paused {
    background: color-mix(in srgb, var(--text-2) 22%, var(--bg-3));
    color: var(--text);
  }

  .phase-pill.idle {
    background: var(--bg-3);
    color: var(--text-2);
  }

  .page-count {
    font-size: 0.8125rem;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .action-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .action-btn-primary {
    background: var(--accent);
    color: white;
    border-color: color-mix(in srgb, var(--accent) 80%, black);
  }

  .action-btn-primary:hover:not(:disabled) {
    filter: brightness(1.07);
  }

  .action-btn-secondary {
    background: transparent;
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 80%, transparent);
  }

  .action-btn-secondary:hover:not(:disabled) {
    background: var(--bg-2);
  }

  .action-btn-ghost {
    background: transparent;
    color: var(--text-2);
    border-color: transparent;
  }

  .action-btn-ghost:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-2);
  }

  .phase-description {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-2);
    line-height: 1.4;
    max-width: 40rem;
  }

  .activity-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .activity-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-2);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
</style>
