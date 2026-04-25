<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fly } from 'svelte/transition'
  import type {
    BackgroundAgentDoc,
    BackgroundTimelineEvent,
    LlmUsageSnapshot,
  } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import type { ToolCall } from '@client/lib/agentUtils.js'
  import ToolCallBlock from '../agent-conversation/ToolCallBlock.svelte'
  import { ChevronDown, Play } from 'lucide-svelte'
  import { computePinnedToBottom } from '@client/lib/scrollPin.js'
  import { backgroundAgentsFromEvents, yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'

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
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
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
    onOpenEmail,
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
   * YourWikiDetail already provides the "Tool calls" heading and status line for the your-wiki run.
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
        await fetch('/api/your-wiki/pause', { method: 'POST' })
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
        await fetch('/api/your-wiki/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timezone }),
        })
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
</script>

<div class="bg-panel" class:bg-panel--hub-embed={embedInHubDetail}>
  {#if embedInHubDetail}
    <div class="bg-panel-hub-flow">
      {#if loadError}
        <p class="bg-panel-muted" role="status">{loadError}</p>
      {:else if !agent}
        <p class="bg-panel-muted" role="status">No active wiki expansion.</p>
      {:else}
        {#if agent.detail?.trim() && !embedDuplicateParentChrome}
          <p class="bg-panel-status-line" aria-live="polite">{agent.detail.trim()}</p>
        {/if}

        {#if usageHudLine}
          <p class="bg-panel-usage-line" aria-live="polite">{usageHudLine}</p>
        {/if}

        {#if agent.error}
          <p class="bg-panel-error" role="alert">{agent.error}</p>
        {/if}

        {#if timelineSorted.length > 0}
          {#if !embedDuplicateParentChrome}
            <div class="bg-panel-section-label">Tool calls</div>
          {/if}
          <ul class="bg-panel-timeline" aria-label="Tool activity, oldest to newest">
            {#each timelineSorted as ev, i (ev.at + ev.toolName + i)}
              <li class="bg-timeline-item">
                <span class="bg-timeline-time">{formatTimelineTime(ev.at)}</span>
                <div class="bg-timeline-tool">
                  <ToolCallBlock
                    toolCall={toToolCall(ev, i)}
                    onOpenWiki={onOpenWiki}
                    onOpenFile={onOpenFile}
                    onOpenEmail={onOpenEmail}
                    onOpenFullInbox={onOpenFullInbox}
                    onSwitchToCalendar={onSwitchToCalendar}
                    onOpenMessageThread={onOpenMessageThread}
                  />
                </div>
              </li>
            {/each}
          </ul>
        {:else if agent.logEntries && agent.logEntries.length > 0}
          {#if !embedDuplicateParentChrome}
            <div class="bg-panel-section-label">Tool calls</div>
          {/if}
          <ul class="bg-panel-activity" aria-label="Expansion activity (legacy)">
            {#each agent.logEntries as entry}
              <li class="bg-panel-activity-line">
                <span class="bg-panel-verb">{entry.verb}</span>
                {#if entry.detail.trim()}
                  <span class="bg-panel-detail-inline">{entry.detail}</span>
                {/if}
              </li>
            {/each}
          </ul>
        {:else if agent.logLines && agent.logLines.length > 0}
          {#if !embedDuplicateParentChrome}
            <div class="bg-panel-section-label">Tool calls</div>
          {/if}
          <ul class="bg-panel-activity" aria-label="Expansion activity (legacy)">
            {#each agent.logLines as line}
              <li class="bg-panel-activity-line bg-panel-activity-fallback">{line}</li>
            {/each}
          </ul>
        {:else}
          {#if !embedDuplicateParentChrome}
            <div class="bg-panel-section-label">Tool calls</div>
          {/if}
          <p class="bg-panel-muted" role="status">
            No tool calls yet. The assistant may be planning; completed steps will show here.
          </p>
        {/if}

        {#if showJumpToLatest}
          <div
            class="bg-jump-anchor bg-jump-anchor--embed"
            in:fly={{ y: 10, duration: jumpTransitionMs }}
            out:fly={{ y: 8, duration: Math.min(jumpTransitionMs, 160) }}
          >
            <button
              type="button"
              class="bg-jump-to-latest"
              class:streaming={agentIsLive}
              aria-label="Jump to latest activity"
              onclick={() => scrollToBottom()}
            >
              {#if agentIsLive}
                <span class="bg-live-pulse" aria-hidden="true"></span>
              {/if}
              <ChevronDown size={16} strokeWidth={2.25} class="bg-jump-chevron" aria-hidden="true" />
              <span class="bg-jump-text">Latest</span>
            </button>
          </div>
        {/if}

        {#if agent.status === 'paused'}
          <div class="bg-panel-paused-notice">
            <p>Pausing wiki expansion and maintenance.</p>
            <button
              type="button"
              class="bg-panel-resume-btn"
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
    <div class="bg-panel-shell">
      <div
        class="bg-panel-scroll"
        bind:this={scrollEl}
        onscroll={syncFollowFromScroll}
      >
        {#if loadError}
          <p class="bg-panel-muted" role="status">{loadError}</p>
      {:else if !agent}
        <p class="bg-panel-muted" role="status">No active wiki expansion.</p>
      {:else}
        {#if !embedInHubDetail}
          <div class="bg-panel-summary">
            <span class="bg-panel-pill">{statusLabel(agent.status)}</span>
            {#if agent.pageCount > 0}
              <span class="bg-panel-count" aria-label="Pages created">{agent.pageCount} pages</span>
            {/if}
            {#if usageHudLine}
              <span class="bg-panel-count bg-panel-count--usage" aria-label="Model token usage estimate"
                >{usageHudLine}</span
              >
            {/if}
          </div>
        {/if}

        {#if agent.detail?.trim()}
            <p class="bg-panel-status-line" aria-live="polite">{agent.detail.trim()}</p>
          {/if}

          {#if agent.error}
            <p class="bg-panel-error" role="alert">{agent.error}</p>
          {/if}

          {#if timelineSorted.length > 0}
            <div class="bg-panel-section-label">Tool calls</div>
            <ul class="bg-panel-timeline" aria-label="Tool activity, oldest to newest">
              {#each timelineSorted as ev, i (ev.at + ev.toolName + i)}
                <li class="bg-timeline-item">
                  <span class="bg-timeline-time">{formatTimelineTime(ev.at)}</span>
                  <div class="bg-timeline-tool">
                    <ToolCallBlock
                      toolCall={toToolCall(ev, i)}
                      onOpenWiki={onOpenWiki}
                      onOpenFile={onOpenFile}
                      onOpenEmail={onOpenEmail}
                      onOpenFullInbox={onOpenFullInbox}
                      onSwitchToCalendar={onSwitchToCalendar}
                      onOpenMessageThread={onOpenMessageThread}
                    />
                  </div>
                </li>
              {/each}
            </ul>
          {:else if agent.logEntries && agent.logEntries.length > 0}
            <div class="bg-panel-section-label">Tool calls</div>
            <ul class="bg-panel-activity" aria-label="Expansion activity (legacy)">
              {#each agent.logEntries as entry}
                <li class="bg-panel-activity-line">
                  <span class="bg-panel-verb">{entry.verb}</span>
                  {#if entry.detail.trim()}
                    <span class="bg-panel-detail-inline">{entry.detail}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else if agent.logLines && agent.logLines.length > 0}
            <div class="bg-panel-section-label">Tool calls</div>
            <ul class="bg-panel-activity" aria-label="Expansion activity (legacy)">
              {#each agent.logLines as line}
                <li class="bg-panel-activity-line bg-panel-activity-fallback">{line}</li>
              {/each}
            </ul>
          {:else}
            <div class="bg-panel-section-label">Tool calls</div>
            <p class="bg-panel-muted" role="status">
              No tool calls yet. The assistant may be planning; completed steps will show here.
            </p>
          {/if}
        {/if}
      </div>

      {#if showJumpToLatest && !embedInHubDetail}
        <div
          class="bg-jump-anchor"
          in:fly={{ y: 10, duration: jumpTransitionMs }}
          out:fly={{ y: 8, duration: Math.min(jumpTransitionMs, 160) }}
        >
          <button
            type="button"
            class="bg-jump-to-latest"
            class:streaming={agentIsLive}
            aria-label="Jump to latest activity"
            onclick={() => scrollToBottom()}
          >
            {#if agentIsLive}
              <span class="bg-live-pulse" aria-hidden="true"></span>
            {/if}
            <ChevronDown size={16} strokeWidth={2.25} class="bg-jump-chevron" aria-hidden="true" />
            <span class="bg-jump-text">Latest</span>
          </button>
        </div>
      {/if}
    </div>

  {#if !embedInHubDetail && agent && (agent.status === 'running' || agent.status === 'queued' || agent.status === 'paused')}
    <div class="bg-panel-footer">
        {#if agent.status === 'running' || agent.status === 'queued'}
          <button
            type="button"
            class="bg-panel-btn"
            onclick={pauseAgent}
            disabled={actionBusy || !effectiveId}
          >
            Pause
          </button>
        {:else if agent.status === 'paused'}
          <button
            type="button"
            class="bg-panel-btn bg-panel-btn-primary"
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
  .bg-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    color: var(--text);
  }

  .bg-panel--hub-embed {
    height: auto;
    min-height: 0;
    flex: 0 1 auto;
    background: transparent;
  }

  .bg-panel-hub-flow {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.15rem 0 0;
    min-width: 0;
  }

  .bg-panel-shell {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .bg-panel-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.75rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .bg-panel-muted {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-2);
  }

  .bg-panel-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .bg-panel-pill {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-2) 90%, var(--border));
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: capitalize;
    color: var(--text);
  }

  .bg-panel-count {
    font-size: 0.8125rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }

  .bg-panel-count--usage {
    min-width: 0;
  }

  .bg-panel-usage-line {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }

  .bg-panel-status-line {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .bg-panel-error {
    margin: 0;
    font-size: 0.875rem;
    color: var(--danger, #e05c5c);
  }

  .bg-panel-section-label {
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-2);
    margin-top: 0.35rem;
  }

  .bg-panel-timeline {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    min-width: 0;
  }

  .bg-timeline-item {
    display: grid;
    grid-template-columns: 4.25rem minmax(0, 1fr);
    gap: 0.4rem 0.5rem;
    align-items: start;
    min-width: 0;
  }

  .bg-timeline-time {
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
    padding-top: 0.2rem;
    white-space: nowrap;
  }

  .bg-timeline-tool {
    min-width: 0;
  }

  .bg-timeline-tool :global(.tool-part) {
    margin: 0;
  }
  .bg-timeline-tool :global(.tool-part:first-child) {
    margin-top: 0;
  }

  .bg-panel-activity {
    margin: 0;
    padding: 0.5rem 0.65rem;
    list-style: none;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-2) 88%, var(--bg));
    font-size: 0.8125rem;
    line-height: 1.45;
    min-width: 0;
  }

  .bg-panel-activity-line {
    padding: 0.15rem 0;
  }
  .bg-panel-activity-line + .bg-panel-activity-line {
    border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }

  .bg-panel-verb {
    font-weight: 600;
    color: var(--text);
    margin-right: 0.35rem;
  }

  .bg-panel-detail-inline {
    color: var(--text-2);
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
  }

  .bg-panel-activity-fallback {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-2);
  }

  .bg-panel-footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.65rem 1rem;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 92%, var(--border));
  }

  .bg-panel-btn {
    padding: 0.45rem 0.85rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }
  .bg-panel-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .bg-panel-btn-primary {
    background: var(--accent);
    color: #fff;
    border-color: transparent;
  }

  .bg-jump-anchor {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 10px;
    display: flex;
    justify-content: center;
    pointer-events: none;
    z-index: 3;
  }

  .bg-jump-anchor--embed {
    position: sticky;
    bottom: 0.75rem;
    left: 0;
    right: 0;
    margin-top: 0.35rem;
    padding-bottom: 0.15rem;
  }

  .bg-jump-to-latest {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px 9px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--border);
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.04),
      0 8px 24px rgba(0, 0, 0, 0.1);
    cursor: pointer;
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      border-color 0.18s ease;
  }

  @media (prefers-color-scheme: dark) {
    .bg-jump-to-latest {
      background: color-mix(in srgb, var(--bg-3) 92%, transparent);
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.2),
        0 10px 28px rgba(0, 0, 0, 0.45);
    }
  }

  .bg-jump-to-latest:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }

  .bg-jump-to-latest:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .bg-jump-to-latest.streaming {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  }

  .bg-jump-to-latest :global(.bg-jump-chevron) {
    flex-shrink: 0;
    opacity: 0.85;
  }

  .bg-live-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--accent);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent);
    animation: bg-jump-live-pulse 1.8s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .bg-live-pulse {
      animation: none;
    }
    .bg-jump-to-latest:hover {
      transform: none;
    }
  }

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

  .bg-jump-text {
    line-height: 1;
  }

  .bg-panel-paused-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 0;
    margin-top: 8px;
    border-top: 1px solid var(--border);
  }

  .bg-panel-paused-notice p {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
  }

  .bg-panel-resume-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: var(--accent);
    color: white;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .bg-panel-resume-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .bg-panel-resume-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
