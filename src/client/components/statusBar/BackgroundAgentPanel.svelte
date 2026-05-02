<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cn } from '@client/lib/cn.js'
  import type {
    BackgroundAgentDoc,
    BackgroundTimelineEvent,
    LlmUsageSnapshot,
  } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import type { ToolCall } from '@client/lib/agentUtils.js'
  import ToolCallBlock from '@components/agent-conversation/ToolCallBlock.svelte'
  import { ChevronDown, Play } from 'lucide-svelte'
  import { computePinnedToBottom } from '@client/lib/scrollPin.js'
  import { backgroundAgentsFromEvents, yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { postYourWikiPause, postYourWikiResume } from '@client/lib/yourWikiLoopApi.js'

  type Props = {
    /** When omitted, the panel picks the most recent active (queued / running / paused) run. */
    id?: string | undefined
    /**
     * Hub detail: transcript flows in the parent scroll (SlideOver body); no inner scroll box,
     * pause/resume footer, or duplicate status row (parent already shows status).
     */
    embedInHubDetail?: boolean
    /** When `embedInHubDetail`, the scrollable element (e.g. YourWikiDetail root) for tail-follow. */
    embedScrollParent?: HTMLElement | undefined
    /** Onboarding seeding: tail the log on every update (ignore “user scrolled up”). */
    alwaysScrollToBottom?: boolean
    onOpenWiki: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
  }

  let {
    id,
    embedInHubDetail = false,
    embedScrollParent = undefined,
    alwaysScrollToBottom = false,
    onOpenWiki,
    onOpenFile,
    onOpenIndexedFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
  }: Props = $props()

  let agent = $state<BackgroundAgentDoc | null>(null)
  let resolvedId = $state<string | undefined>(undefined)
  let loadError = $state<string | null>(null)
  let actionBusy = $state(false)

  let scrollEl = $state<HTMLElement | undefined>(undefined)
  /** Stick to bottom while activity updates; user scroll up disables until Latest (BUG-007 pattern). */
  let followOutput = $state(true)
  let ignoreScrollEvents = false
  let reduceMotion = $state(false)

  const effectiveId = $derived(id ?? resolvedId)

  /**
   * YourWikiDetail already provides the "Steps" heading and status line for the your-wiki run.
   * Wiki-expansion runs (explicit `id`) embed without that wrapper — keep the in-panel section label.
   */
  const embedDuplicateParentChrome = $derived(
    embedInHubDetail && (id === undefined || id === 'your-wiki'),
  )

  const timelineSorted = $derived.by((): BackgroundTimelineEvent[] => {
    const t = agent?.timeline
    if (!t?.length) return []
    return [...t].sort((a, b) => a.at.localeCompare(b.at))
  })

  const showJumpToLatest = $derived(
    !alwaysScrollToBottom &&
      !followOutput &&
      !!agent &&
      (!embedInHubDetail || !!embedScrollParent),
  )

  const jumpTransitionMs = $derived(reduceMotion ? 0 : 200)

  const agentIsLive = $derived(
    agent?.status === 'running' || agent?.status === 'queued' || agent?.status === 'paused',
  )

  function formatTimelineTime(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  function toToolCall(ev: BackgroundTimelineEvent, index: number): ToolCall {
    return {
      id: `${ev.at}-${index}-${ev.toolName}`,
      name: ev.toolName,
      args: ev.args ?? {},
      result: ev.result,
      details: ev.details,
      isError: ev.isError,
      done: true,
    }
  }

  /** Live doc from `/api/events` SSE — Your Wiki vs wiki-expansion run by `id`. */
  $effect(() => {
    void id
    const unsubYour = yourWikiDocFromEvents.subscribe((d) => {
      const useYourWiki = id === undefined || id === 'your-wiki'
      if (!useYourWiki || !d) return
      loadError = null
      resolvedId = d.id
      agent = d
    })
    const unsubAgents = backgroundAgentsFromEvents.subscribe((agents) => {
      if (id === undefined || id === 'your-wiki') return
      const a = agents.find((x) => x.id === id)
      loadError = null
      if (a) {
        resolvedId = a.id
        agent = a
      } else {
        agent = null
      }
    })
    return () => {
      unsubYour()
      unsubAgents()
    }
  })

  onMount(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reduceMotion = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)

    return () => {
      mq.removeEventListener('change', sync)
    }
  })

  function getScrollTarget(): HTMLElement | undefined {
    if (embedInHubDetail) return embedScrollParent
    return scrollEl
  }

  function syncFollowFromScroll() {
    if (ignoreScrollEvents) return
    const el = getScrollTarget()
    if (!el) return
    followOutput = computePinnedToBottom(el)
  }

  function scrollToBottom() {
    ignoreScrollEvents = true
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = getScrollTarget()
          if (!el) {
            ignoreScrollEvents = false
            return
          }
          el.scrollTop = el.scrollHeight
          followOutput = true
          ignoreScrollEvents = false
        })
      })
    })
  }

  function scrollToBottomIfFollowing() {
    if (!followOutput) return
    ignoreScrollEvents = true
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = getScrollTarget()
          if (!el) {
            ignoreScrollEvents = false
            return
          }
          if (followOutput) {
            el.scrollTop = el.scrollHeight
          }
          ignoreScrollEvents = false
        })
      })
    })
  }

  $effect(() => {
    if (embedInHubDetail && !embedScrollParent) return
    void effectiveId
    void embedScrollParent
    void alwaysScrollToBottom
    void tick().then(() => scrollToBottom())
  })

  $effect(() => {
    if (embedInHubDetail && !embedScrollParent) return
    void timelineSorted.length
    void agent?.detail
    void agent?.updatedAt
    void agent?.pageCount
    void agent?.usageCumulative
    void agent?.usageLastInvocation
    void alwaysScrollToBottom
    void tick().then(() =>
      alwaysScrollToBottom ? scrollToBottom() : scrollToBottomIfFollowing(),
    )
  })

  $effect(() => {
    if (!embedInHubDetail) return
    const el = embedScrollParent
    if (!el) return
    const onScroll = () => syncFollowFromScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    syncFollowFromScroll()
    return () => el.removeEventListener('scroll', onScroll)
  })

  function statusLabel(s: string): string {
    return s.replace(/-/g, ' ')
  }

  function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  /** Human-readable model usage for Hub (non-authoritative cost estimate from the provider stack). */
  function formatUsageSnapshot(u: LlmUsageSnapshot): string {
    const parts: string[] = []
    if (u.totalTokens > 0) parts.push(`${formatTokenCount(u.totalTokens)} tok`)
    if (u.costTotal > 0) parts.push(`~$${u.costTotal.toFixed(3)}`)
    return parts.length > 0 ? parts.join(' · ') : ''
  }

  const usageHudLine = $derived.by((): string | null => {
    const a = agent
    if (!a) return null
    const last = a.usageLastInvocation
    const cum = a.usageCumulative
    if (cum && last && cum.totalTokens !== last.totalTokens) {
      const t = formatUsageSnapshot(cum)
      const l = formatUsageSnapshot(last)
      if (t && l) return `Run total: ${t} · last pass: ${l}`
    }
    const one = cum ?? last
    if (!one) return null
    const s = formatUsageSnapshot(one)
    return s || null
  })

  function isYourWikiRun(): boolean {
    const eid = effectiveId
    return eid === 'your-wiki' || agent?.kind === 'your-wiki'
  }

  async function pauseAgent() {
    actionBusy = true
    try {
      const eid = effectiveId
      if (!eid) return
      if (isYourWikiRun()) {
        await postYourWikiPause()
      } else {
        await fetch(`/api/background/agents/${encodeURIComponent(eid)}/pause`, { method: 'POST' })
      }
    } finally {
      actionBusy = false
    }
  }

  async function resumeAgent() {
    actionBusy = true
    try {
      const eid = effectiveId
      if (!eid) return
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (isYourWikiRun()) {
        await postYourWikiResume()
      } else {
        await fetch(`/api/background/agents/${encodeURIComponent(eid)}/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone }),
        })
      }
    } finally {
      actionBusy = false
    }
  }

  // Shared style fragments — keeps both branches (hub embed + standalone) visually identical.
  const mutedClass = 'bg-panel-muted m-0 text-sm text-muted'
  const statusLineClass =
    'bg-panel-status-line m-0 whitespace-pre-wrap break-words text-[0.8125rem] leading-[1.45] text-muted'
  const usageLineClass =
    'bg-panel-usage-line m-0 text-xs leading-[1.4] text-muted [font-variant-numeric:tabular-nums]'
  const errorClass = 'bg-panel-error m-0 text-sm text-danger'
  const sectionLabel =
    'bg-panel-section-label mt-[0.35rem] text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted'
  const timelineClass =
    'bg-panel-timeline m-0 flex min-w-0 list-none flex-col gap-[0.65rem] p-0'
  const timelineItemClass =
    'bg-timeline-item grid min-w-0 grid-cols-[4.25rem_minmax(0,1fr)] items-start gap-x-2 gap-y-[0.4rem]'
  const timelineTimeClass =
    'bg-timeline-time whitespace-nowrap pt-[0.2rem] text-[0.6875rem] text-muted [font-variant-numeric:tabular-nums]'
  const timelineToolClass = 'bg-timeline-tool min-w-0'
  const activityListClass =
    'bg-panel-activity m-0 min-w-0 list-none border border-border bg-[color-mix(in_srgb,var(--bg-2)_88%,var(--bg))] px-[0.65rem] py-2 text-[0.8125rem] leading-[1.45]'
  const activityLineClass =
    'bg-panel-activity-line py-[0.15rem] [&+&]:border-t [&+&]:border-[color-mix(in_srgb,var(--border)_55%,transparent)]'
  const verbClass = 'bg-panel-verb mr-[0.35rem] font-semibold text-foreground'
  const detailInlineClass =
    'bg-panel-detail-inline text-xs text-muted [font-family:ui-monospace,monospace]'
  const fallbackLineClass =
    'bg-panel-activity-fallback whitespace-pre-wrap break-words py-[0.15rem] text-xs text-muted [font-family:ui-monospace,monospace] [&+&]:border-t [&+&]:border-[color-mix(in_srgb,var(--border)_55%,transparent)]'

  const jumpAnchorBase =
    'bg-jump-anchor pointer-events-none z-[3] flex justify-center'
  const jumpAnchorOverlay = 'absolute inset-x-0 bottom-[10px]'
  const jumpAnchorEmbed =
    'bg-jump-anchor--embed sticky inset-x-0 bottom-3 mt-[0.35rem] pb-[0.15rem]'
  const jumpButton =
    'bg-jump-to-latest pointer-events-auto inline-flex cursor-pointer items-center gap-[6px] border border-border bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] py-[9px] pl-[14px] pr-[16px] text-xs font-semibold uppercase tracking-[0.04em] text-foreground shadow-[0_2px_4px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.1)] transition-[transform,box-shadow,border-color] duration-[180ms] [backdrop-filter:blur(10px)] [-webkit-backdrop-filter:blur(10px)] hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 motion-reduce:hover:translate-y-0 dark:bg-[color-mix(in_srgb,var(--bg-3)_92%,transparent)] dark:shadow-[0_2px_4px_rgba(0,0,0,0.2),0_10px_28px_rgba(0,0,0,0.45)]'
  const jumpButtonStreaming =
    'streaming border-[color-mix(in_srgb,var(--accent)_28%,var(--border))]'
  const livePulseClass =
    'bg-live-pulse h-[7px] w-[7px] shrink-0 bg-accent shadow-[0_0_0_0_color-mix(in_srgb,var(--accent)_45%,transparent)] [animation:bg-jump-live-pulse_1.8s_ease-in-out_infinite] motion-reduce:[animation:none]'
  const jumpTextClass = 'bg-jump-text leading-none'

  const pillClass =
    'bg-panel-pill inline-flex items-center border border-border bg-[color-mix(in_srgb,var(--bg-2)_90%,var(--border))] px-2 py-[0.15rem] text-xs font-semibold capitalize text-foreground'
  const countClass =
    'bg-panel-count text-[0.8125rem] text-muted [font-variant-numeric:tabular-nums]'
  const countUsageClass = 'bg-panel-count--usage min-w-0'

  const pausedNoticeClass =
    'bg-panel-paused-notice mt-2 flex items-center justify-between gap-3 border-t border-border py-3'
  const resumeBtnClass =
    'bg-panel-resume-btn inline-flex cursor-pointer items-center gap-[6px] border-0 bg-accent px-[14px] py-[6px] text-xs font-semibold text-white transition-[filter] duration-150 hover:not-disabled:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'

  const bgPanelBtnClass =
    'bg-panel-btn cursor-pointer border border-border bg-surface-2 px-[0.85rem] py-[0.45rem] text-[0.8125rem] font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-45'
  const bgPanelBtnPrimary =
    'bg-panel-btn-primary border-transparent bg-accent text-white'
</script>

<div
  class={cn(
    'bg-panel flex h-full min-h-0 flex-col bg-surface text-foreground',
    embedInHubDetail && 'bg-panel--hub-embed h-auto min-h-0 flex-[0_1_auto] bg-transparent',
  )}
>
  {#if embedInHubDetail}
    <div class="bg-panel-hub-flow flex min-w-0 flex-col gap-[0.65rem] pt-[0.15rem]">
      {#if loadError}
        <p class={mutedClass} role="status">{loadError}</p>
      {:else if !agent}
        <p class={mutedClass} role="status">No active wiki expansion.</p>
      {:else}
        {#if agent.detail?.trim() && !embedDuplicateParentChrome}
          <p class={statusLineClass} aria-live="polite">{agent.detail.trim()}</p>
        {/if}

        {#if usageHudLine}
          <p class={usageLineClass} aria-live="polite">{usageHudLine}</p>
        {/if}

        {#if agent.error}
          <p class={errorClass} role="alert">{agent.error}</p>
        {/if}

        {#if timelineSorted.length > 0}
          {#if !embedDuplicateParentChrome}
            <div class={sectionLabel}>Steps</div>
          {/if}
          <ul class={timelineClass} aria-label="Steps in order, oldest first">
            {#each timelineSorted as ev, i (ev.at + ev.toolName + i)}
              <li class={timelineItemClass}>
                <span class={timelineTimeClass}>{formatTimelineTime(ev.at)}</span>
                <div class={timelineToolClass}>
                  <ToolCallBlock
                    toolCall={toToolCall(ev, i)}
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
              </li>
            {/each}
          </ul>
        {:else if agent.logEntries && agent.logEntries.length > 0}
          {#if !embedDuplicateParentChrome}
            <div class={sectionLabel}>Steps</div>
          {/if}
          <ul class={activityListClass} aria-label="Expansion activity (legacy)">
            {#each agent.logEntries as entry, i (i)}
              <li class={activityLineClass}>
                <span class={verbClass}>{entry.verb}</span>
                {#if entry.detail.trim()}
                  <span class={detailInlineClass}>{entry.detail}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {:else if agent.logLines && agent.logLines.length > 0}
          {#if !embedDuplicateParentChrome}
            <div class={sectionLabel}>Steps</div>
          {/if}
          <ul class={activityListClass} aria-label="Expansion activity (legacy)">
            {#each agent.logLines as line, i (i)}
              <li class={fallbackLineClass}>{line}</li>
            {/each}
          </ul>
        {:else}
          {#if !embedDuplicateParentChrome}
            <div class={sectionLabel}>Steps</div>
          {/if}
          <p class={mutedClass} role="status">
            No steps yet. The assistant may be planning; completed work will appear here.
          </p>
        {/if}

        {#if showJumpToLatest}
          <div
            class={cn(jumpAnchorBase, jumpAnchorEmbed)}
            in:fly={{ y: 10, duration: jumpTransitionMs }}
            out:fly={{ y: 8, duration: Math.min(jumpTransitionMs, 160) }}
          >
            <button
              type="button"
              class={cn(jumpButton, agentIsLive && jumpButtonStreaming)}
              aria-label="Jump to latest activity"
              onclick={() => scrollToBottom()}
            >
              {#if agentIsLive}
                <span class={livePulseClass} aria-hidden="true"></span>
              {/if}
              <ChevronDown
                size={16}
                strokeWidth={2.25}
                class="bg-jump-chevron"
                aria-hidden="true"
              />
              <span class={jumpTextClass}>Latest</span>
            </button>
          </div>
        {/if}

        {#if agent.status === 'paused'}
          <div class={pausedNoticeClass}>
            <p class="m-0 text-[13px] text-muted">Pausing wiki expansion and maintenance.</p>
            <button
              type="button"
              class={resumeBtnClass}
              disabled={actionBusy}
              onclick={resumeAgent}
            >
              <Play size={12} fill="currentColor" />
              Resume
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {:else}
    <div class="bg-panel-shell relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        class="bg-panel-scroll flex min-h-0 flex-1 flex-col gap-[0.65rem] overflow-auto px-4 pb-4 pt-3"
        bind:this={scrollEl}
        onscroll={syncFollowFromScroll}
      >
        {#if loadError}
          <p class={mutedClass} role="status">{loadError}</p>
        {:else if !agent}
          <p class={mutedClass} role="status">No active wiki expansion.</p>
        {:else}
          {#if !embedInHubDetail}
            <div class="bg-panel-summary flex flex-wrap items-center gap-2">
              <span class={pillClass}>{statusLabel(agent.status)}</span>
              {#if agent.pageCount > 0}
                <span class={countClass} aria-label="Pages created">{agent.pageCount} pages</span>
              {/if}
              {#if usageHudLine}
                <span
                  class={cn(countClass, countUsageClass)}
                  aria-label="Model token usage estimate"
                >{usageHudLine}</span>
              {/if}
            </div>
          {/if}

          {#if agent.detail?.trim()}
            <p class={statusLineClass} aria-live="polite">{agent.detail.trim()}</p>
          {/if}

          {#if agent.error}
            <p class={errorClass} role="alert">{agent.error}</p>
          {/if}

          {#if timelineSorted.length > 0}
            <div class={sectionLabel}>Steps</div>
            <ul class={timelineClass} aria-label="Steps in order, oldest first">
              {#each timelineSorted as ev, i (ev.at + ev.toolName + i)}
                <li class={timelineItemClass}>
                  <span class={timelineTimeClass}>{formatTimelineTime(ev.at)}</span>
                  <div class={timelineToolClass}>
                    <ToolCallBlock
                      toolCall={toToolCall(ev, i)}
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
                </li>
              {/each}
            </ul>
          {:else if agent.logEntries && agent.logEntries.length > 0}
            <div class={sectionLabel}>Steps</div>
            <ul class={activityListClass} aria-label="Expansion activity (legacy)">
              {#each agent.logEntries as entry, i (i)}
                <li class={activityLineClass}>
                  <span class={verbClass}>{entry.verb}</span>
                  {#if entry.detail.trim()}
                    <span class={detailInlineClass}>{entry.detail}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else if agent.logLines && agent.logLines.length > 0}
            <div class={sectionLabel}>Steps</div>
            <ul class={activityListClass} aria-label="Expansion activity (legacy)">
              {#each agent.logLines as line, i (i)}
                <li class={fallbackLineClass}>{line}</li>
              {/each}
            </ul>
          {:else}
            <div class={sectionLabel}>Steps</div>
            <p class={mutedClass} role="status">
              No steps yet. The assistant may be planning; completed work will appear here.
            </p>
          {/if}
        {/if}
      </div>

      {#if showJumpToLatest && !embedInHubDetail}
        <div
          class={cn(jumpAnchorBase, jumpAnchorOverlay)}
          in:fly={{ y: 10, duration: jumpTransitionMs }}
          out:fly={{ y: 8, duration: Math.min(jumpTransitionMs, 160) }}
        >
          <button
            type="button"
            class={cn(jumpButton, agentIsLive && jumpButtonStreaming)}
            aria-label="Jump to latest activity"
            onclick={() => scrollToBottom()}
          >
            {#if agentIsLive}
              <span class={livePulseClass} aria-hidden="true"></span>
            {/if}
            <ChevronDown
              size={16}
              strokeWidth={2.25}
              class="bg-jump-chevron"
              aria-hidden="true"
            />
            <span class={jumpTextClass}>Latest</span>
          </button>
        </div>
      {/if}
    </div>

    {#if !embedInHubDetail && agent && (agent.status === 'running' || agent.status === 'queued' || agent.status === 'paused')}
      <div
        class="bg-panel-footer flex shrink-0 justify-end gap-2 border-t border-border bg-[color-mix(in_srgb,var(--bg)_92%,var(--border))] px-4 py-[0.65rem]"
      >
        {#if agent.status === 'running' || agent.status === 'queued'}
          <button
            type="button"
            class={bgPanelBtnClass}
            onclick={pauseAgent}
            disabled={actionBusy || !effectiveId}
          >
            Pause
          </button>
        {:else if agent.status === 'paused'}
          <button
            type="button"
            class={cn(bgPanelBtnClass, bgPanelBtnPrimary)}
            onclick={resumeAgent}
            disabled={actionBusy || !effectiveId}
          >
            Resume
          </button>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Lucide chevron icon class is set via the component's `class` prop and needs `:global` reach. */
  :global(.bg-jump-chevron) {
    flex-shrink: 0;
    opacity: 0.85;
  }

  /* Tool-call subcomponent renders `.tool-part` deep in the tree; collapse default margins inline. */
  .bg-timeline-tool :global(.tool-part) {
    margin: 0;
  }
  .bg-timeline-tool :global(.tool-part:first-child) {
    margin-top: 0;
  }

  /* Live indicator pulse — keyframes only (referenced from a Tailwind arbitrary `animation:` utility). */
  @keyframes bg-jump-live-pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 40%, transparent);
    }
    50% {
      opacity: 0.75;
      box-shadow: 0 0 0 6px transparent;
    }
  }
</style>
