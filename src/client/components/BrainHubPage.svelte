<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw, ChevronRight, BookOpen } from 'lucide-svelte'
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
  import { postYourWikiPause, postYourWikiResume, postYourWikiRunLap } from '@client/lib/yourWikiLoopApi.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
  import { onboardingMailStatusFromBackground } from '@client/lib/hub/backgroundStatusMap.js'
  import HubActivityOverview from '@components/hub/HubActivityOverview.svelte'
  import HubSharingSection from '@components/hub/HubSharingSection.svelte'
  import { startHubEventsConnection } from '@client/lib/hubEvents/hubEventsClient.js'

  /** Background snapshot read from `/api/background-status` — poll while Hub is open. */
  const HUB_BACKGROUND_STATUS_POLL_MS = 4000

  type HubRipmailSourceRow = {
    id: string
    kind: string
    displayName: string
    path: string | null
  }

  type Props = {
    /** Cross-workspace brain query hub summary; true only when server enables `BRAIN_B2B_ENABLED`. */
    brainQueryEnabled?: boolean
    onHubNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    /** Opens Settings primary column (`/settings`); when set, Manage uses SPA navigation. */
    onOpenSettings?: () => void
    /** Opens Brain-to-brain policy UI (`/settings/brain-access`). */
    onOpenBrainAccess?: () => void
  }

  let { brainQueryEnabled = false, onHubNavigate, onOpenSettings, onOpenBrainAccess }: Props = $props()

  let docCount = $state<number | null>(null)
  let wikiDoc = $state<BackgroundAgentDoc | null>(null)
  let mailStatus = $state<OnboardingMailStatus | null>(null)
  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  let wikiRecentEdits = $state<{ path: string; date: string }[]>([])
  let wikiRecentReady = $state(false)
  let hostedWorkspaceHandle = $state<string | undefined>(undefined)
  let wikiActionBusy = $state(false)
  let backgroundStatusLoading = $state(true)
  let syncKickBusy = $state(false)
  let wikiBackgroundUpdateBusy = $state(false)

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
        return lastLine ?? 'Cleaning up links and orphaned pages'
      case 'paused':
        return lastLine ?? 'Tap Resume when you want background updates again'
      case 'error': {
        const msg = (wikiDoc.error ?? wikiDoc.detail ?? 'Open details for more').trim()
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

  function applyBackgroundStatusPayload(bg: BackgroundStatusResponse): void {
    mailStatus = onboardingMailStatusFromBackground(bg.mail)
    if (wikiDoc == null && bg.wiki) {
      wikiDoc = {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: bg.wiki.status,
        label: 'Your Wiki',
        detail: bg.wiki.detail,
        pageCount: bg.wiki.pageCount,
        logLines: [],
        logEntries: [],
        timeline: [],
        startedAt: bg.wiki.lastRunAt ?? bg.updatedAt,
        updatedAt: bg.wiki.lastRunAt ?? bg.updatedAt,
        phase: bg.wiki.phase,
        lap: bg.wiki.currentLap,
        error: bg.wiki.error,
      }
    }
  }

  async function refreshBackgroundStatusPoll(): Promise<void> {
    try {
      const bgRes = await fetch('/api/background-status', { credentials: 'include' })
      if (!bgRes.ok) return
      const bg = (await bgRes.json()) as BackgroundStatusResponse
      applyBackgroundStatusPayload(bg)
    } catch {
      /* ignore */
    }
  }

  /** Summary line for connected sources row in the overview card. */
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
    backgroundStatusLoading = true
    try {
      const [wikiRes, bgRes, sourcesRes] = await Promise.all([
        fetch('/api/wiki', { credentials: 'include' }),
        fetch('/api/background-status', { credentials: 'include' }),
        fetch('/api/hub/sources', { credentials: 'include' }),
      ])

      if (wikiRes.ok) {
        docCount = parseWikiListApiBody(await wikiRes.json()).files.length
      }
      if (bgRes.ok) {
        applyBackgroundStatusPayload((await bgRes.json()) as BackgroundStatusResponse)
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
      backgroundStatusLoading = false
    }
  }

  async function syncMailNow() {
    if (syncKickBusy || mailStatus?.syncRunning) return
    syncKickBusy = true
    try {
      await fetch('/api/inbox/sync', { method: 'POST', credentials: 'include' })
      await fetchData()
    } finally {
      syncKickBusy = false
    }
  }

  async function runWikiBackgroundUpdateNow() {
    if (wikiBackgroundUpdateBusy) return
    wikiBackgroundUpdateBusy = true
    try {
      await postYourWikiRunLap()
      await fetchData()
    } finally {
      wikiBackgroundUpdateBusy = false
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
    const pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refreshBackgroundStatusPoll()
    }, HUB_BACKGROUND_STATUS_POLL_MS)
    const unsubEvents = subscribe((e) => {
      if (e.type === 'hub:sources-changed' || e.type === 'wiki:mutated' || e.type === 'sync:completed') {
        void fetchData()
      }
    })
    const unsubWikiStore = yourWikiDocFromEvents.subscribe((doc) => {
      if (doc) wikiDoc = doc
    })
    const stopHubEvents = startHubEventsConnection()
    return () => {
      clearInterval(pollTimer)
      unsubEvents()
      unsubWikiStore()
      stopHubEvents()
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

  const sectionHeaderBase =
    'section-header flex items-center gap-3 border-b border-border pb-3 text-foreground'
  const linkItemBase =
    'link-item flex cursor-pointer items-center justify-between border-0 border-b border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent py-2 text-left text-foreground transition-[padding,color] duration-150 hover:not-disabled:not-[.static]:not-[.disabled]:pl-1 hover:not-disabled:not-[.static]:not-[.disabled]:text-accent'
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

  <div class="hub-grid flex flex-col gap-10">
    <HubActivityOverview
      mailStatus={mailStatus}
      mailLoading={backgroundStatusLoading}
      wikiTitle={wikiHubTitle}
      wikiSubtitle={wikiHubSub}
      wikiPhase={wikiPhase}
      wikiIsActive={wikiIsActive}
      wikiIsPaused={wikiIsPaused}
      wikiIsIdle={wikiIsIdle}
      showWikiControls={Boolean(wikiDoc && wikiPhase != null)}
      onSyncNow={syncMailNow}
      onWikiUpdateNow={runWikiBackgroundUpdateNow}
      onPause={wikiPause}
      onResume={wikiResume}
      syncBusy={syncKickBusy || Boolean(mailStatus?.syncRunning)}
      wikiUpdateBusy={wikiBackgroundUpdateBusy}
      wikiActionBusy={wikiActionBusy}
      indexFeedSummary={indexFeedSummary}
      sourcesEmpty={orderedHubSources.length === 0}
      sourcesError={hubSourcesError}
      onOpenSettings={onOpenSettings}
    />

    <section class="hub-section your-wiki-section flex flex-col gap-5" aria-label="Wiki activity">
      <div class={cn(sectionHeaderBase, 'section-header-wiki')}>
        <BookOpen size={18} />
        <h2 class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">Wiki activity</h2>
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
        Peek at pages the background job touched recently—or open the full log to see each step.
      </p>

      <div class="links-list flex flex-col">
        <button
          type="button"
          class={cn(linkItemBase, 'hub-source-row')}
          onclick={() => onHubNavigate({ type: 'your-wiki' })}
        >
          <div
            class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium"
          >
            <HubSourceRowBody title="Open wiki background log" subtitle="Tool steps, timing, and errors">
              {#snippet icon()}
                {#if wikiIsActive}
                  <RefreshCw size={16} class={cn('spin-icon shrink-0 text-accent')} aria-hidden="true" />
                {:else}
                  <BookOpen size={16} class="shrink-0 text-muted" aria-hidden="true" />
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

    {#if brainQueryEnabled}
      <HubSharingSection
        onManageBrainAccess={() => {
          onOpenBrainAccess?.()
        }}
      />
    {/if}
  </div>
</div>

<style>
  :global(.spin-icon) {
    animation: hub-spin 2s linear infinite;
  }

  @keyframes hub-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.spin-icon) {
      animation: none;
    }
  }
</style>
