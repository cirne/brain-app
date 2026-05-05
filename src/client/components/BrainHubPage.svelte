<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw, ChevronRight, BookOpen, FileText, Radio, Pause, Play } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import type { OnboardingMailStatus } from '@client/lib/onboarding/onboardingTypes.js'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { wikiVaultPathDisplayName } from '@client/lib/wikiFileNameLabels.js'
  import WikiFileName from '@components/WikiFileName.svelte'
  import { fetchVaultStatus } from '@client/lib/vaultClient.js'
  import HubSourceRowBody from '@components/HubSourceRowBody.svelte'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { postYourWikiPause, postYourWikiResume } from '@client/lib/yourWikiLoopApi.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'

  type HubRipmailSourceRow = {
    id: string
    kind: string
    displayName: string
    path: string | null
  }

  type Props = {
    onHubNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    /** Opens Settings primary column (`/settings`); when set, click uses SPA navigation. */
    onOpenSettings?: () => void
  }

  let { onHubNavigate, onOpenSettings }: Props = $props()

  let docCount = $state<number | null>(null)
  let wikiDoc = $state<BackgroundAgentDoc | null>(null)
  let mailStatus = $state<OnboardingMailStatus | null>(null)
  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  let wikiRecentEdits = $state<{ path: string; date: string }[]>([])
  let wikiRecentReady = $state(false)
  let hostedWorkspaceHandle = $state<string | undefined>(undefined)
  let wikiActionBusy = $state(false)

  const wikiPhase = $derived(wikiDoc?.phase as YourWikiPhase | undefined)
  const wikiIsActive = $derived(
    wikiPhase === 'starting' || wikiPhase === 'enriching' || wikiPhase === 'cleaning',
  )
  const wikiIsPaused = $derived(wikiPhase === 'paused')
  const wikiIsIdle = $derived(
    wikiPhase === 'idle' ||
      (!wikiIsActive && wikiPhase !== 'paused' && wikiPhase !== 'error'),
  )

  const wikiPageCount = $derived(wikiDoc != null ? wikiDoc.pageCount : docCount)

  async function fetchWikiRecentEditsList(): Promise<{ path: string; date: string }[]> {
    try {
      const histRes = await fetch('/api/wiki/edit-history?limit=5')
      if (histRes.ok) {
        const j = (await histRes.json()) as { files?: { path: string; date: string }[] }
        const files = Array.isArray(j.files) ? j.files : []
        if (files.length > 0) return files
      }
      const recentRes = await fetch('/api/wiki/recent?limit=5')
      if (recentRes.ok) {
        const j = (await recentRes.json()) as { files?: { path: string; date: string }[] }
        return Array.isArray(j.files) ? j.files : []
      }
    } catch {
      /* ignore */
    }
    return []
  }

  const wikiHubTitle = $derived.by(() => {
    if (!wikiDoc) return 'Your Wiki'
    switch (wikiPhase) {
      case 'starting':
        return 'Building your first pages'
      case 'enriching':
        return 'Expanding your wiki'
      case 'cleaning':
        return 'Tidying links and pages'
      case 'paused':
        return 'Wiki updates paused'
      case 'error':
        return 'Something went wrong'
      case 'idle':
        return wikiDoc.detail === 'Pausing between laps' ? 'Taking a short break' : 'Wiki is up to date'
      default:
        return 'Your Wiki'
    }
  })

  const wikiHubSub = $derived.by(() => {
    if (!wikiDoc) return 'Loading status…'
    const last = wikiDoc.lastWikiPath?.trim()
    const lastLine = last ? `Last: ${wikiVaultPathDisplayName(last)}` : null

    switch (wikiPhase) {
      case 'starting':
        return lastLine ?? 'Getting everything ready…'
      case 'enriching':
        if (lastLine) return lastLine
        if ((wikiDoc.detail ?? '').includes('Sync')) return wikiDoc.detail ?? 'Preparing sources…'
        return 'Looking for pages to improve'
      case 'cleaning':
        return lastLine ?? 'Cleaning up from the last pass'
      case 'paused':
        return lastLine ?? 'Press Resume when you want background updates again'
      case 'error': {
        const msg = (wikiDoc.error ?? wikiDoc.detail ?? 'Open for details').trim()
        return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg
      }
      case 'idle':
        if (wikiDoc.detail === 'Pausing between laps') {
          return lastLine ?? 'Next pass soon'
        }
        if (wikiDoc.idleReason) {
          const short = wikiDoc.idleReason.split(/\s*[—–-]\s*/)[0]?.trim() ?? wikiDoc.idleReason
          return lastLine ? `${short} · ${lastLine}` : short
        }
        return lastLine ?? (wikiPageCount != null ? `${wikiPageCount} pages in your wiki` : 'Ready when you are')
      default:
        return lastLine ?? (wikiDoc.detail || '…')
    }
  })

  function sourceTier(kind: string): number {
    if (kind === 'imap' || kind === 'applemail') return 0
    if (
      kind === 'googleCalendar' ||
      kind === 'appleCalendar' ||
      kind === 'icsSubscription' ||
      kind === 'icsFile'
    ) {
      return 1
    }
    if (kind === 'localDir') return 2
    return 3
  }

  const orderedHubSources = $derived(
    [...hubSources].sort((a, b) => {
      const t = sourceTier(a.kind) - sourceTier(b.kind)
      if (t !== 0) return t
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    }),
  )

  /** Aggregate counts for Activity — avoids duplicating the per-connection list from Settings. */
  const indexFeedSummary = $derived.by(() => {
    let mail = 0
    let cal = 0
    let other = 0
    for (const s of orderedHubSources) {
      if (s.kind === 'imap' || s.kind === 'applemail') mail++
      else if (
        s.kind === 'googleCalendar' ||
        s.kind === 'appleCalendar' ||
        s.kind === 'icsSubscription' ||
        s.kind === 'icsFile'
      ) {
        cal++
      } else other++
    }
    const bits: string[] = []
    if (mail) bits.push(`${mail} mailbox${mail === 1 ? '' : 'es'}`)
    if (cal) bits.push(`${cal} calendar${cal === 1 ? '' : 's'}`)
    if (other) bits.push(`${other} folder${other === 1 ? '' : 's'}`)
    return bits.join(' · ')
  })

  async function fetchData() {
    try {
      const [wikiRes, mailRes, sourcesRes] = await Promise.all([
        fetch('/api/wiki', { credentials: 'include' }),
        fetch('/api/inbox/mail-sync-status', { credentials: 'include' }),
        fetch('/api/hub/sources', { credentials: 'include' }),
      ])

      if (wikiRes.ok) {
        docCount = parseWikiListApiBody(await wikiRes.json()).files.length
      }
      if (mailRes.ok) {
        mailStatus = await mailRes.json()
      }
      if (sourcesRes.ok) {
        const j = (await sourcesRes.json()) as { sources?: HubRipmailSourceRow[]; error?: string }
        hubSources = Array.isArray(j.sources) ? j.sources : []
        hubSourcesError = typeof j.error === 'string' && j.error.trim() ? j.error : null
      }
      wikiRecentEdits = await fetchWikiRecentEditsList()
    } catch {
      /* ignore */
    } finally {
      wikiRecentReady = true
    }
  }

  onMount(() => {
    void fetchVaultStatus()
      .then((v) => {
        if (
          v.multiTenant === true &&
          v.handleConfirmed === true &&
          typeof v.workspaceHandle === 'string' &&
          v.workspaceHandle.length > 0
        ) {
          hostedWorkspaceHandle = v.workspaceHandle
        } else {
          hostedWorkspaceHandle = undefined
        }
      })
      .catch(() => {
        hostedWorkspaceHandle = undefined
      })
    void fetchData()
    const unsubEvents = subscribe((e) => {
      if (e.type === 'hub:sources-changed' || e.type === 'wiki:mutated' || e.type === 'sync:completed') {
        void fetchData()
      }
    })
    const unsubWikiStore = yourWikiDocFromEvents.subscribe((doc) => {
      if (doc) wikiDoc = doc
    })
    return () => {
      unsubEvents()
      unsubWikiStore()
    }
  })

  function formatRelativeDate(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffSec < 60) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHour < 24) return `${diffHour}h ago`
    if (diffDay === 1) return 'Yesterday'
    if (diffDay < 7) return `${diffDay}d ago`
    return d.toLocaleDateString()
  }

  function formatSyncLockAge(ms: number | null): string {
    if (ms == null || ms < 60_000) return ''
    const m = Math.floor(ms / 60_000)
    if (m < 60) return ` · ${m}m`
    const h = Math.floor(m / 60)
    return ` · ${h}h`
  }

  async function wikiPause() {
    if (wikiActionBusy) return
    wikiActionBusy = true
    try {
      await postYourWikiPause()
    } finally {
      wikiActionBusy = false
    }
  }

  async function wikiResume() {
    if (wikiActionBusy) return
    wikiActionBusy = true
    try {
      await postYourWikiResume()
    } finally {
      wikiActionBusy = false
    }
  }

  /** Section header (icon + h2 + optional trailing slot). */
  const sectionHeaderBase =
    'section-header flex items-center gap-3 border-b border-border pb-3 text-foreground'
  /** Hub link rows: shared visual recipe (chevron + hover affordance). */
  const linkItemBase =
    'link-item flex cursor-pointer items-center justify-between border-0 border-b border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent py-2 text-left text-foreground transition-[padding,color] duration-150 hover:not-disabled:not-[.static]:not-[.disabled]:pl-1 hover:not-disabled:not-[.static]:not-[.disabled]:text-accent'
  /** Wiki loop pill buttons (Pause / Resume). */
  const wikiLoopBtn =
    'wiki-loop-btn inline-flex cursor-pointer items-center gap-[0.3rem] rounded-md border border-transparent px-[0.7rem] py-[0.3rem] text-[0.8125rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55'
  const wikiLoopBtnPrimary =
    'wiki-loop-btn-primary border-[color-mix(in_srgb,var(--accent)_80%,black)] bg-accent text-white hover:not-disabled:[filter:brightness(1.07)]'
  const wikiLoopBtnSecondary =
    'wiki-loop-btn-secondary border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-transparent text-foreground hover:not-disabled:bg-surface-2'
</script>

<div
  class="hub-page mx-auto flex w-full max-w-[900px] flex-col gap-12 px-8 py-10 text-foreground max-md:px-4 max-md:py-6"
>
  <header class="hub-header border-b border-border pb-4">
    <div class="hub-header-content">
      <h1 class="m-0 text-[2rem] font-extrabold tracking-[-0.02em]">Activity</h1>
      <div
        class={cn(
          'hub-header-deck mt-2',
          !!hostedWorkspaceHandle && 'hub-header-deck--hosted flex flex-col gap-[0.3rem]',
        )}
      >
        {#if hostedWorkspaceHandle}
          <p
            class="hub-handle-line m-0 font-mono text-[0.9375rem] font-medium tracking-[0.02em] text-muted"
            translate="no"
          >@{hostedWorkspaceHandle}</p>
        {/if}
      </div>
    </div>
  </header>

  <div class="hub-grid grid grid-cols-1 gap-14">
    <section class="hub-section your-wiki-section flex flex-col gap-6" aria-label="Your Wiki">
      <div class={cn(sectionHeaderBase, 'section-header-wiki')}>
        <BookOpen size={18} />
        <h2 class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">Your Wiki</h2>
        <span
          class="wiki-header-metrics ml-auto flex shrink-0 items-baseline gap-2"
          aria-live="polite"
          aria-label={wikiPageCount != null ? `${wikiPageCount} pages` : 'Page count loading'}
        >
          <span
            class="wiki-header-count text-[1.25rem] font-bold tracking-[-0.01em] tabular-nums text-foreground"
            aria-hidden="true"
          >{wikiPageCount ?? '—'}</span>
          <span
            class="wiki-header-count-label text-xs font-semibold uppercase tracking-[0.05em] text-muted"
            aria-hidden="true"
          >pages</span>
        </span>
      </div>
      <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-[1.45] text-muted">
        Your wiki connects pages in your vault into one place for synthesized knowledge—threading context from email
        and other sources so it grows more useful over time. Braintunnel refines it in the background; pause or resume
        anytime with the controls below, or open the row for the full activity log.
      </p>
      {#if wikiDoc && wikiPhase}
        <div
          class="wiki-loop-toolbar -mt-1 mb-[0.35rem] flex flex-wrap items-center"
          role="group"
          aria-label="Background wiki updates"
        >
          <div class="wiki-loop-toolbar-actions flex flex-wrap items-center gap-2">
            {#if wikiIsActive || (wikiIsIdle && !wikiIsPaused)}
              <button
                type="button"
                class={cn(wikiLoopBtn, wikiLoopBtnSecondary)}
                disabled={wikiActionBusy}
                onclick={() => void wikiPause()}
                title="Pause background wiki updates"
              >
                <Pause size={14} aria-hidden="true" />
                Pause
              </button>
            {:else if wikiIsPaused || wikiPhase === 'error'}
              <button
                type="button"
                class={cn(wikiLoopBtn, wikiLoopBtnPrimary)}
                disabled={wikiActionBusy}
                onclick={() => void wikiResume()}
                title="Resume background wiki updates"
              >
                <Play size={14} aria-hidden="true" />
                Resume
              </button>
            {/if}
          </div>
        </div>
      {/if}
      <div class="links-list flex flex-col">
        <button
          type="button"
          class={cn(linkItemBase, 'hub-source-row')}
          onclick={() => onHubNavigate({ type: 'your-wiki' })}
        >
          <div
            class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium"
          >
            <HubSourceRowBody title={wikiHubTitle} subtitle={wikiHubSub}>
              {#snippet icon()}
                {#if wikiIsActive}
                  <RefreshCw size={16} class="spin-icon" aria-hidden="true" />
                {:else}
                  <BookOpen size={16} aria-hidden="true" />
                {/if}
              {/snippet}
            </HubSourceRowBody>
          </div>
          {#if wikiIsPaused}
            <div class="link-status flex flex-col items-end gap-px">
              <span
                class="status-pill paused bg-[color-mix(in_srgb,var(--text-2)_22%,var(--bg-3))] px-2 py-px text-[0.625rem] font-extrabold uppercase tracking-[0.05em] text-foreground"
              >Paused</span>
            </div>
          {/if}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        {#if wikiRecentReady && wikiRecentEdits.length > 0}
          <div
            class="wiki-recent-block mt-[0.35rem] flex flex-col border-t border-t-[color-mix(in_srgb,var(--border)_40%,transparent)] pt-3"
            aria-label="Recent wiki edits"
          >
            <p
              class="wiki-recent-label mb-[0.35rem] mt-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted"
            >Recent edits</p>
            {#each wikiRecentEdits as f (f.path)}
              <button
                type="button"
                class={cn(
                  linkItemBase,
                  'hub-source-row wiki-recent-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-[0.45rem]',
                )}
                onclick={() => onHubNavigate({ type: 'wiki', path: f.path })}
              >
                <div
                  class="link-info wiki-recent-row-main flex min-w-0 items-center gap-3 text-[0.9375rem] font-medium"
                >
                  <HubSourceRowBody subtitle="">
                    {#snippet icon()}
                      <FileText size={16} aria-hidden="true" />
                    {/snippet}
                    {#snippet titleContent()}
                      <WikiFileName path={f.path} />
                    {/snippet}
                  </HubSourceRowBody>
                </div>
                <div class="wiki-recent-row-meta inline-flex shrink-0 items-center justify-end gap-2">
                  <span
                    class="status-sub wiki-recent-time whitespace-nowrap text-xs text-muted"
                  >{formatRelativeDate(f.date)}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </div>
              </button>
            {/each}
          </div>
        {:else if wikiRecentReady}
          <p
            class="empty-msg wiki-recent-empty mt-2 border-t border-t-[color-mix(in_srgb,var(--border)_40%,transparent)] px-0 pb-0 pt-[0.65rem] text-[0.8125rem] text-muted"
          >No recent edits recorded yet.</p>
        {/if}
      </div>
    </section>

    <section class="hub-section search-index-section flex flex-col gap-6" aria-labelledby="hub-index-heading">
      <div class={sectionHeaderBase}>
        <Radio size={18} />
        <h2 id="hub-index-heading" class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">Search index</h2>
      </div>
      <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-[1.45] text-muted">
        Braintunnel indexes your email, calendars, and other connected sources for instant access and lightning-fast
        search while you work in chat. Add or manage data sources in
        <a
          href="/settings"
          class="section-lead-strong section-lead-settings-link cursor-pointer font-[650] text-foreground underline decoration-[color-mix(in_srgb,var(--text)_40%,transparent)] underline-offset-2 hover:decoration-[var(--text)]"
          onclick={(e) => {
            if (onOpenSettings) {
              e.preventDefault()
              onOpenSettings()
            }
          }}
        >
          Settings
        </a>
        .
      </p>
      <div
        class="index-status-strip flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] pb-[0.85rem] pt-[0.65rem] text-[0.8125rem] text-muted"
        role="status"
        aria-live="polite"
      >
        {#if mailStatus?.statusError}
          <span class="index-status-err cursor-help text-[var(--text-3)]" title={mailStatus.statusError}>Mail index status unavailable</span>
        {:else if mailStatus}
          <span class="index-status-primary font-semibold text-foreground"
            >{mailStatus.indexedTotal != null ? mailStatus.indexedTotal : '—'} messages in index</span
          >
          {#if mailStatus.syncRunning}
            <span class="status-sub status-syncing inline-flex items-center gap-1.5 font-semibold text-accent">
              <span class="sync-dot h-1.5 w-1.5 shrink-0 bg-accent" aria-hidden="true"></span>
              Syncing{formatSyncLockAge(mailStatus.syncLockAgeMs)}…
            </span>
          {:else if mailStatus.lastSyncedAt}
            <span class="status-sub text-xs text-muted">Last synced {formatRelativeDate(mailStatus.lastSyncedAt)}</span>
          {:else if mailStatus.configured}
            <span class="status-sub text-xs text-muted">No sync time yet</span>
          {/if}
        {:else}
          <span class="status-sub text-xs text-muted">Loading index status…</span>
        {/if}
      </div>
      {#if hubSourcesError}
        <p class="empty-msg hub-sources-err m-0 cursor-help py-4 text-[0.9375rem] text-muted" title={hubSourcesError}>Could not load connection summary.</p>
      {:else if orderedHubSources.length === 0}
        <p class="empty-msg m-0 py-4 text-[0.9375rem] text-muted">No connections yet. Add mail or calendars in Settings.</p>
      {:else}
        <p class="index-feed-summary m-0 px-0 pt-[0.35rem] text-[0.9375rem] leading-[1.45] text-foreground" aria-live="polite">
          <span
            class="index-feed-summary-label mb-[0.35rem] block text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted"
          >Feeding this index:</span>
          {indexFeedSummary}
        </p>
      {/if}
    </section>
  </div>
</div>

<style>
  /* Reach into lucide SVG inside HubSourceRowBody for the spin animation. */
  :global(.spin-icon) {
    animation: hub-spin 2s linear infinite;
  }

  @keyframes hub-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes hub-sync-pulse {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(0.92);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .sync-dot {
    animation: hub-sync-pulse 1.2s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.spin-icon),
    .sync-dot {
      animation: none;
    }
  }
</style>
