<script lang="ts">
  import { onMount, getContext } from 'svelte'
  import { Sparkles, Pause, Play, RefreshCw } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import BackgroundAgentPanel from '@components/statusBar/BackgroundAgentPanel.svelte'
  import { YOUR_WIKI_HEADER, type RegisterYourWikiHeader } from '@client/lib/yourWikiHeaderContext.js'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { postYourWikiPause, postYourWikiResume, postYourWikiRunLap } from '@client/lib/yourWikiLoopApi.js'
  import { yourWikiNarrativeLine } from '@client/lib/yourWikiNarrative.js'

  type Props = {
    onOpenWiki: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_chat: string, _label: string) => void
    /** When true, omit the intro paragraph (e.g. onboarding already explains Your Wiki on the left). */
    hideSectionLead?: boolean
    /**
     * When false, omit pause / resume / run background update (e.g. onboarding split view—activity only).
     * Hub / SlideOver keep default `true`.
     */
    showLoopControls?: boolean
    /** Seeding / hub: follow new tool rows to the bottom (live tail). */
    autoScrollActivity?: boolean
    /**
     * When true, the view sizes to its content (no extra vertical flex growth). Use in narrow
     * split layouts so the parent does not show a void below short content.
     */
    shrinkToContent?: boolean
    /**
     * When the tool log is scrolled in an outer element (e.g. onboarding right column), pass that
     * element so `autoScrollActivity` can set `scrollTop` on the real scrollport.
     */
    activityScrollContainer?: HTMLElement | undefined
  }

  let {
    onOpenWiki,
    onOpenFile,
    onOpenIndexedFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    hideSectionLead = false,
    showLoopControls = true,
    autoScrollActivity = false,
    shrinkToContent = false,
    activityScrollContainer = undefined,
  }: Props = $props()

  let doc = $state<BackgroundAgentDoc | null>(null)
  let actionBusy = $state(false)
  let detailScrollRoot = $state<HTMLElement | undefined>(undefined)

  const phase = $derived(doc?.phase as YourWikiPhase | undefined)
  const isActive = $derived(phase === 'starting' || phase === 'enriching' || phase === 'cleaning')
  const isIdle = $derived(phase === 'idle' || (!isActive && phase !== 'paused' && phase !== 'error'))
  const isPaused = $derived(phase === 'paused')

  const statusNarrative = $derived(
    doc ? yourWikiNarrativeLine(phase, doc.detail) : 'Loading…',
  )

  const panelScrollTarget = $derived(activityScrollContainer ?? detailScrollRoot)

  async function pause() {
    if (actionBusy) return
    actionBusy = true
    try {
      await postYourWikiPause()
    } finally {
      actionBusy = false
    }
  }

  async function resume() {
    if (actionBusy) return
    actionBusy = true
    try {
      await postYourWikiResume()
    } finally {
      actionBusy = false
    }
  }

  async function runBackgroundUpdate() {
    if (actionBusy) return
    actionBusy = true
    try {
      await postYourWikiRunLap()
    } finally {
      actionBusy = false
    }
  }

  onMount(() => {
    return yourWikiDocFromEvents.subscribe((d) => {
      if (d) doc = d
    })
  })

  const registerHeader = getContext<RegisterYourWikiHeader | undefined>(YOUR_WIKI_HEADER)
  $effect(() => {
    if (!registerHeader) return
    registerHeader({
      doc,
      actionBusy,
      pause,
      resume,
    })
    return () => registerHeader(null)
  })

  const actionBtnBase =
    'action-btn inline-flex cursor-pointer items-center gap-[0.3rem] rounded-md border border-transparent px-[0.7rem] py-[0.3rem] text-[0.8125rem] font-semibold transition-[background,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-55'
  const actionBtnPrimary =
    'action-btn-primary border-[color-mix(in_srgb,var(--accent)_80%,black)] bg-accent text-white enabled:hover:[filter:brightness(1.07)]'
  const actionBtnSecondary =
    'action-btn-secondary border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-transparent text-foreground enabled:hover:bg-surface-2'
  const actionBtnGhost =
    'action-btn-ghost border-transparent bg-transparent text-muted enabled:hover:bg-surface-2 enabled:hover:text-foreground'

  const phasePillBase =
    'phase-pill bg-surface-3 px-2 py-[2px] text-[0.625rem] font-extrabold uppercase tracking-[0.05em] text-muted'
</script>

<div
  class={cn(
    'your-wiki-detail flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 pb-6 pt-4',
    hideSectionLead && 'your-wiki-detail--embed gap-4 px-4 pb-4 pt-3',
    shrinkToContent && 'your-wiki-detail--tight flex-[0_1_auto] self-stretch overflow-visible',
  )}
  bind:this={detailScrollRoot}
>
  {#if !hideSectionLead}
    <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-snug text-muted">
      Your Wiki improves continuously in the background—enriching pages from your mail and profile, then cleaning up
      links and structure. Pause anytime; when you resume, the next background pass starts fresh.
    </p>
  {/if}

  {#if doc}
    <div
      class={cn(
        'status-row flex flex-wrap items-center justify-between gap-3',
        !showLoopControls && 'status-row--no-actions justify-start',
      )}
    >
      <div class="status-info flex flex-wrap items-center gap-2">
        <span
          class={cn(
            phasePillBase,
            isActive && 'active bg-accent text-white',
            isPaused && 'paused bg-[color-mix(in_srgb,var(--text-2)_22%,var(--bg-3))] text-foreground',
            isIdle && 'idle bg-surface-3 text-muted',
          )}
        >
          {phase === 'starting' ? 'Starting' :
           phase === 'enriching' ? 'Enriching' :
           phase === 'cleaning' ? 'Cleaning up' :
           phase === 'paused' ? 'Paused' :
           phase === 'error' ? 'Error' :
           'Idle'}
        </span>
        {#if doc.pageCount > 0}
          <span class="page-count text-[0.8125rem] text-muted [font-variant-numeric:tabular-nums]"
            >{doc.pageCount} pages</span
          >
        {/if}
      </div>
      {#if showLoopControls}
        <div class="actions flex flex-wrap items-center gap-2">
          {#if isActive || (isIdle && !isPaused)}
            <button
              type="button"
              class="{actionBtnBase} {actionBtnSecondary}"
              disabled={actionBusy}
              onclick={pause}
              title="Pause background wiki updates"
            >
              <Pause size={14} aria-hidden="true" />
              Pause
            </button>
          {:else if isPaused || phase === 'error'}
            <button
              type="button"
              class="{actionBtnBase} {actionBtnPrimary}"
              disabled={actionBusy}
              onclick={resume}
              title="Resume background wiki updates (starts the next pass)"
            >
              <Play size={14} aria-hidden="true" />
              Resume
            </button>
          {/if}
          {#if isIdle && !isPaused}
            <button
              type="button"
              class="{actionBtnBase} {actionBtnGhost}"
              disabled={actionBusy}
              onclick={runBackgroundUpdate}
              title="Run a background wiki refresh now"
            >
              <RefreshCw size={14} aria-hidden="true" />
              Update wiki now
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <p class="phase-description m-0 max-w-[40rem] text-sm leading-snug text-muted">
      {statusNarrative}
    </p>
  {:else}
    <p class="phase-description m-0 max-w-[40rem] text-sm leading-snug text-muted">Loading…</p>
  {/if}

  <div class="activity-section flex flex-col gap-2">
    <div
      class="activity-label flex items-center gap-1.5 border-b border-border pb-2 text-xs font-bold uppercase tracking-[0.07em] text-muted"
    >
      <Sparkles size={14} aria-hidden="true" />
      Steps
    </div>
    <BackgroundAgentPanel
      embedInHubDetail
      embedScrollParent={panelScrollTarget}
      alwaysScrollToBottom={autoScrollActivity}
      {onOpenWiki}
      {onOpenFile}
      {onOpenIndexedFile}
      {onOpenEmail}
      {onOpenDraft}
      {onOpenFullInbox}
      {onSwitchToCalendar}
      {onOpenMessageThread}
    />
  </div>
</div>
