<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { Sparkles, Pause, Play, RefreshCw } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import BackgroundAgentPanel from '@components/statusBar/BackgroundAgentPanel.svelte'
  import { getYourWikiHeaderCell } from '@client/lib/yourWikiHeaderContext.js'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { postYourWikiPause, postYourWikiResume, postYourWikiRunLap } from '@client/lib/yourWikiLoopApi.js'
  import { yourWikiNarrativeLine } from '@client/lib/yourWikiNarrative.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    onOpenWiki: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_chat: string, _label: string) => void
    onOpenVisualArtifact?: (_ref: string, _label?: string) => void
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
    onOpenVisualArtifact,
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
  const isActive = $derived(
    phase === 'starting' || phase === 'surveying' || phase === 'enriching' || phase === 'cleaning',
  )
  const isIdle = $derived(phase === 'idle' || (!isActive && phase !== 'paused' && phase !== 'error'))
  const isPaused = $derived(phase === 'paused')

  const statusNarrative = $derived(
    doc ? yourWikiNarrativeLine(phase, doc.detail) : $t('common.status.loading'),
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

  const yourWikiHeaderCell = getYourWikiHeaderCell()

  /**
   * Claim once with stable `pause` / `resume` handlers. Reactive scalars (`doc`, `actionBusy`)
   * are pushed via `patch` in the effect below. Initial reads are wrapped in `untrack` so
   * Svelte does not warn about capturing initial values. See archived BUG-047 (effect depth / slide headers).
   */
  const yourWikiHeaderCtrl = yourWikiHeaderCell?.claim(
    untrack(() => ({
      doc,
      actionBusy,
      pause,
      resume,
    })),
  )

  $effect(() => {
    yourWikiHeaderCtrl?.patch({
      doc,
      actionBusy,
    })
  })

  onDestroy(() => {
    yourWikiHeaderCtrl?.clear()
  })

  const actionBtnBase =
    'action-btn inline-flex cursor-pointer items-center gap-[0.3rem] rounded-md border border-transparent px-[0.7rem] py-[0.3rem] text-[0.8125rem] font-semibold transition-[background,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-55'
  const actionBtnPrimary =
    'action-btn-primary border-[color-mix(in_srgb,var(--accent)_80%,black)] bg-accent text-accent-foreground enabled:hover:[filter:brightness(1.07)]'
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
      {$t('wiki.yourWikiDetail.sectionLead')}
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
            isActive && 'active bg-accent text-accent-foreground',
            isPaused && 'paused bg-[color-mix(in_srgb,var(--text-2)_22%,var(--bg-3))] text-foreground',
            isIdle && 'idle bg-surface-3 text-muted',
          )}
        >
          {phase === 'starting' ? $t('nav.yourWiki.phase.starting') :
           phase === 'surveying' ? $t('nav.yourWiki.phase.surveying') :
           phase === 'enriching' ? $t('nav.yourWiki.phase.enriching') :
           phase === 'cleaning' ? $t('nav.yourWiki.phase.cleaning') :
           phase === 'paused' ? $t('nav.yourWiki.phase.paused') :
           phase === 'error' ? $t('nav.yourWiki.phase.error') :
           $t('nav.yourWiki.phase.idle')}
        </span>
        {#if doc.pageCount > 0}
          <span class="page-count text-[0.8125rem] text-muted [font-variant-numeric:tabular-nums]"
            >{$t('nav.yourWiki.pageCount', { count: doc.pageCount })}</span
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
              title={$t('wiki.yourWikiDetail.actions.pauseTitle')}
            >
              <Pause size={14} aria-hidden="true" />
              {$t('common.actions.pause')}
            </button>
          {:else if isPaused || phase === 'error'}
            <button
              type="button"
              class="{actionBtnBase} {actionBtnPrimary}"
              disabled={actionBusy}
              onclick={resume}
              title={$t('wiki.yourWikiDetail.actions.resumeTitle')}
            >
              <Play size={14} aria-hidden="true" />
              {$t('common.actions.resume')}
            </button>
          {/if}
          {#if isIdle && !isPaused}
            <button
              type="button"
              class="{actionBtnBase} {actionBtnGhost}"
              disabled={actionBusy}
              onclick={runBackgroundUpdate}
              title={$t('wiki.yourWikiDetail.actions.updateNowTitle')}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {$t('wiki.yourWikiDetail.actions.updateNow')}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <p class="phase-description m-0 max-w-[40rem] text-sm leading-snug text-muted">
      {statusNarrative}
    </p>
  {:else}
    <p class="phase-description m-0 max-w-[40rem] text-sm leading-snug text-muted">{$t('common.status.loading')}</p>
  {/if}

  <div class="activity-section flex flex-col gap-2">
    <div
      class="activity-label flex items-center gap-1.5 border-b border-border pb-2 text-xs font-bold uppercase tracking-[0.07em] text-muted"
    >
      <Sparkles size={14} aria-hidden="true" />
      {$t('wiki.yourWikiDetail.steps')}
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
      {onOpenVisualArtifact}
    />
  </div>
</div>
