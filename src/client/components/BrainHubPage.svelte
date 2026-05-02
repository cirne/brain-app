<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw, ChevronRight, BookOpen, FileText, Radio, Pause, Play, Share2 } from 'lucide-svelte'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import type { OnboardingMailStatus } from '@client/lib/onboarding/onboardingTypes.js'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { subscribe, emit } from '@client/lib/app/appEvents.js'
  import { fetchWikiSharesList, type WikiShareApiRow } from '@client/lib/wikiSharesClient.js'
  import { wikiPathParentDir } from '@client/lib/wikiPathDisplay.js'
  import { fetchVaultStatus } from '@client/lib/vaultClient.js'
  import HubSourceRowBody from './HubSourceRowBody.svelte'
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
    /** After accepting a share, open the shared wiki in the main shell. */
    onNavigateToSharedWiki?: (_p: {
      ownerId: string
      ownerHandle: string
      pathPrefix: string
      targetKind: 'dir' | 'file'
    }) => void
  }

  let { onHubNavigate, onOpenSettings, onNavigateToSharedWiki }: Props = $props()

  let docCount = $state<number | null>(null)
  let wikiDoc = $state<BackgroundAgentDoc | null>(null)
  let mailStatus = $state<OnboardingMailStatus | null>(null)
  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  let wikiRecentEdits = $state<{ path: string; date: string }[]>([])
  let wikiRecentReady = $state(false)
  let hostedWorkspaceHandle = $state<string | undefined>(undefined)
  let wikiActionBusy = $state(false)

  let shareOwned = $state<WikiShareApiRow[]>([])
  let shareReceived = $state<WikiShareApiRow[]>([])
  let sharePending = $state<WikiShareApiRow[]>([])
  let shareLoadError = $state<string | null>(null)
  let shareAcceptBusyId = $state<string | null>(null)
  let shareRevokeBusyId = $state<string | null>(null)

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

  function wikiPathBasename(rel: string): string {
    const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts[parts.length - 1] ?? rel
  }

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
    const lastLine = last ? `Last: ${wikiPathBasename(last)}` : null

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

  async function loadWikiShares() {
    shareLoadError = null
    try {
      const data = await fetchWikiSharesList()
      if (!data) {
        shareLoadError = 'Could not load sharing.'
        return
      }
      shareOwned = data.owned ?? []
      shareReceived = data.received ?? []
      sharePending = data.pendingReceived ?? []
    } catch {
      shareLoadError = 'Could not load sharing.'
    }
  }

  function scrollSharingHash() {
    if (typeof location === 'undefined' || location.hash !== '#sharing') return
    queueMicrotask(() => {
      document.getElementById('hub-sharing')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function acceptPendingShare(row: WikiShareApiRow) {
    if (shareAcceptBusyId) return
    shareAcceptBusyId = row.id
    try {
      const res = await fetch(`/api/wiki-shares/${encodeURIComponent(row.id)}/accept`, { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        ownerId?: string
        ownerHandle?: string
        pathPrefix?: string
        targetKind?: 'dir' | 'file'
        error?: string
        message?: string
      }
      if (!res.ok || !j.ok || typeof j.ownerId !== 'string') {
        shareLoadError = j.message ?? j.error ?? 'Could not accept invite.'
        return
      }
      onNavigateToSharedWiki?.({
        ownerId: j.ownerId,
        ownerHandle: typeof j.ownerHandle === 'string' ? j.ownerHandle : row.ownerHandle,
        pathPrefix: typeof j.pathPrefix === 'string' ? j.pathPrefix : row.pathPrefix,
        targetKind: j.targetKind === 'file' ? 'file' : 'dir',
      })
      await loadWikiShares()
      emit({ type: 'wiki-shares-changed' })
    } finally {
      shareAcceptBusyId = null
    }
  }

  async function revokeOwnedShare(row: WikiShareApiRow) {
    if (shareRevokeBusyId) return
    shareRevokeBusyId = row.id
    try {
      const res = await fetch(`/api/wiki-shares/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        shareLoadError = 'Could not revoke share.'
        return
      }
      await loadWikiShares()
      emit({ type: 'wiki-shares-changed' })
    } finally {
      shareRevokeBusyId = null
    }
  }

  function openReceivedShare(row: WikiShareApiRow) {
    onNavigateToSharedWiki?.({
      ownerId: row.ownerId,
      ownerHandle: row.ownerHandle,
      pathPrefix: row.pathPrefix,
      targetKind: row.targetKind,
    })
  }

  function sharePathLabel(row: WikiShareApiRow): string {
    const p = row.pathPrefix.trim().replace(/\\/g, '/')
    if (row.targetKind === 'file') return p
    return p.endsWith('/') ? p.slice(0, -1) || '(wiki root)' : p
  }

  async function fetchData() {
    try {
      const [wikiRes, mailRes, sourcesRes] = await Promise.all([
        fetch('/api/wiki'),
        fetch('/api/inbox/mail-sync-status'),
        fetch('/api/hub/sources'),
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
    void loadWikiShares()
    scrollSharingHash()
    const unsubEvents = subscribe((e) => {
      if (e.type === 'hub:sources-changed' || e.type === 'wiki:mutated' || e.type === 'sync:completed') {
        void fetchData()
      }
      if (e.type === 'wiki-shares-changed') void loadWikiShares()
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
</script>

<div class="hub-page">
  <header class="hub-header">
    <div class="hub-header-content">
      <h1>Activity</h1>
      <div class="hub-header-deck" class:hub-header-deck--hosted={!!hostedWorkspaceHandle}>
        {#if hostedWorkspaceHandle}
          <p class="hub-handle-line" translate="no">@{hostedWorkspaceHandle}</p>
        {/if}
      </div>
    </div>
  </header>

  <div class="hub-grid">
    <section class="hub-section your-wiki-section" aria-label="Your Wiki">
      <div class="section-header section-header-wiki">
        <BookOpen size={18} />
        <h2>Your Wiki</h2>
        <span
          class="wiki-header-metrics"
          aria-live="polite"
          aria-label={wikiPageCount != null ? `${wikiPageCount} pages` : 'Page count loading'}
        >
          <span class="wiki-header-count" aria-hidden="true">{wikiPageCount ?? '—'}</span>
          <span class="wiki-header-count-label" aria-hidden="true">pages</span>
        </span>
      </div>
      <p class="section-lead">
        Your wiki connects pages in your vault into one place for synthesized knowledge—threading context from email
        and other sources so it grows more useful over time. Braintunnel refines it in the background; pause or resume
        anytime with the controls below, or open the row for the full activity log.
      </p>
      {#if wikiDoc && wikiPhase}
        <div class="wiki-loop-toolbar" role="group" aria-label="Background wiki updates">
          <div class="wiki-loop-toolbar-actions">
            {#if wikiIsActive || (wikiIsIdle && !wikiIsPaused)}
              <button
                type="button"
                class="wiki-loop-btn wiki-loop-btn-secondary"
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
                class="wiki-loop-btn wiki-loop-btn-primary"
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
      <div class="links-list">
        <button
          type="button"
          class="link-item hub-source-row"
          onclick={() => onHubNavigate({ type: 'your-wiki' })}
        >
          <div class="link-info">
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
            <div class="link-status">
              <span class="status-pill paused">Paused</span>
            </div>
          {/if}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        {#if wikiRecentReady && wikiRecentEdits.length > 0}
          <div class="wiki-recent-block" aria-label="Recent wiki edits">
            <p class="wiki-recent-label">Recent edits</p>
            {#each wikiRecentEdits as f (f.path)}
              {@const parentDir = wikiPathParentDir(f.path)}
              <button
                type="button"
                class="link-item hub-source-row wiki-recent-row"
                onclick={() => onHubNavigate({ type: 'wiki', path: f.path })}
              >
                <div class="link-info wiki-recent-row-main">
                  <HubSourceRowBody
                    title={wikiPathBasename(f.path)}
                    subtitle={parentDir ?? 'Wiki root'}
                  >
                    {#snippet icon()}
                      <FileText size={16} />
                    {/snippet}
                  </HubSourceRowBody>
                </div>
                <div class="wiki-recent-row-meta">
                  <span class="status-sub wiki-recent-time">{formatRelativeDate(f.date)}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </div>
              </button>
            {/each}
          </div>
        {:else if wikiRecentReady}
          <p class="empty-msg wiki-recent-empty">No recent edits recorded yet.</p>
        {/if}
      </div>
    </section>

    <section id="hub-sharing" class="hub-section hub-sharing-section" aria-labelledby="hub-sharing-heading">
      <div class="section-header">
        <Share2 size={18} />
        <h2 id="hub-sharing-heading">Sharing</h2>
      </div>
      <p class="section-lead">
        Accept read-only wiki invites from others and manage what you have shared. Invites match your
        <strong>primary mailbox email</strong> from Settings; acceptance happens here, not through email links.
      </p>
      {#if shareLoadError}
        <p class="empty-msg hub-sharing-err" role="alert">{shareLoadError}</p>
      {/if}

      {#if sharePending.length > 0}
        <div class="hub-share-block">
          <h3 class="hub-share-subhead">Invitations</h3>
          <ul class="hub-share-list">
            {#each sharePending as row (row.id)}
              <li class="hub-share-row">
                <div class="hub-share-main">
                  <span class="hub-share-path" translate="no"><code>{sharePathLabel(row)}</code></span>
                  <span class="hub-share-meta">From @{row.ownerHandle} · {row.granteeEmail}</span>
                </div>
                <button
                  type="button"
                  class="hub-share-btn hub-share-btn-primary"
                  disabled={shareAcceptBusyId !== null}
                  onclick={() => void acceptPendingShare(row)}
                >
                  {shareAcceptBusyId === row.id ? 'Accepting…' : 'Accept'}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="hub-share-block">
        <h3 class="hub-share-subhead">Shared with you</h3>
        {#if shareReceived.length === 0}
          <p class="empty-msg hub-share-empty">No active shared wikis yet.</p>
        {:else}
          <ul class="hub-share-list">
            {#each shareReceived as row (row.id)}
              <li class="hub-share-row">
                <div class="hub-share-main">
                  <span class="hub-share-path" translate="no"><code>{sharePathLabel(row)}</code></span>
                  <span class="hub-share-meta">@{row.ownerHandle}</span>
                </div>
                <button
                  type="button"
                  class="hub-share-btn"
                  onclick={() => openReceivedShare(row)}
                >
                  Open
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="hub-share-block">
        <h3 class="hub-share-subhead">What you’ve shared</h3>
        {#if shareOwned.length === 0}
          <p class="empty-msg hub-share-empty">You have not shared any wiki paths yet.</p>
        {:else}
          <ul class="hub-share-list">
            {#each shareOwned as row (row.id)}
              <li class="hub-share-row">
                <div class="hub-share-main">
                  <span class="hub-share-path" translate="no"><code>{sharePathLabel(row)}</code></span>
                  <span class="hub-share-meta">
                    → {row.granteeEmail}
                    {#if row.granteeId}
                      <span class="hub-share-pill">Active</span>
                    {:else}
                      <span class="hub-share-pill hub-share-pill-muted">Pending</span>
                    {/if}
                  </span>
                </div>
                <button
                  type="button"
                  class="hub-share-btn hub-share-btn-danger"
                  disabled={shareRevokeBusyId !== null}
                  onclick={() => void revokeOwnedShare(row)}
                >
                  {shareRevokeBusyId === row.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>

    <section class="hub-section search-index-section" aria-labelledby="hub-index-heading">
      <div class="section-header">
        <Radio size={18} />
        <h2 id="hub-index-heading">Search index</h2>
      </div>
      <p class="section-lead">
        Braintunnel indexes your email, calendars, and other connected sources for instant access and lightning-fast
        search while you work in chat. Add or manage data sources in
        <a
          href="/settings"
          class="section-lead-strong section-lead-settings-link"
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
      <div class="index-status-strip" role="status" aria-live="polite">
        {#if mailStatus?.statusError}
          <span class="index-status-err" title={mailStatus.statusError}>Mail index status unavailable</span>
        {:else if mailStatus}
          <span class="index-status-primary"
            >{mailStatus.indexedTotal != null ? mailStatus.indexedTotal : '—'} messages in index</span
          >
          {#if mailStatus.syncRunning}
            <span class="status-sub status-syncing">
              <span class="sync-dot" aria-hidden="true"></span>
              Syncing{formatSyncLockAge(mailStatus.syncLockAgeMs)}…
            </span>
          {:else if mailStatus.lastSyncedAt}
            <span class="status-sub">Last synced {formatRelativeDate(mailStatus.lastSyncedAt)}</span>
          {:else if mailStatus.configured}
            <span class="status-sub">No sync time yet</span>
          {/if}
        {:else}
          <span class="status-sub">Loading index status…</span>
        {/if}
      </div>
      {#if hubSourcesError}
        <p class="empty-msg hub-sources-err" title={hubSourcesError}>Could not load connection summary.</p>
      {:else if orderedHubSources.length === 0}
        <p class="empty-msg">No connections yet. Add mail or calendars in Settings.</p>
      {:else}
        <p class="index-feed-summary" aria-live="polite">
          <span class="index-feed-summary-label">Feeding this index:</span>
          {indexFeedSummary}
        </p>
      {/if}
    </section>
  </div>
</div>

<style>
  .hub-page {
    padding: 2.5rem 2rem;
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 3rem;
    color: var(--text);
  }

  .hub-header {
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .hub-header-deck {
    margin: 0.5rem 0 0;
  }

  .hub-header-deck--hosted {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .hub-handle-line {
    margin: 0;
    font-size: 0.9375rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 500;
    color: var(--text-2);
    letter-spacing: 0.02em;
  }

  .hub-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 3.5rem;
  }

  .wiki-recent-block {
    display: flex;
    flex-direction: column;
    margin-top: 0.35rem;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  }

  .wiki-recent-label {
    margin: 0 0 0.35rem;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
  }

  .wiki-recent-row {
    padding-top: 0.45rem;
    padding-bottom: 0.45rem;
  }

  .wiki-recent-row-main {
    min-width: 0;
  }

  .wiki-recent-row-meta {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .wiki-recent-time {
    font-size: 0.75rem;
    color: var(--text-2);
    white-space: nowrap;
  }

  .wiki-recent-empty {
    margin-top: 0.5rem;
    padding: 0.65rem 0 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    font-size: 0.8125rem;
  }

  .hub-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  :global(.spin-icon) {
    animation: spin 2s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text);
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .section-header-wiki .wiki-header-metrics {
    margin-left: auto;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-shrink: 0;
  }

  .wiki-header-count {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }

  .wiki-header-count-label {
    font-size: 0.75rem;
    color: var(--text-2);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .wiki-loop-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    margin: -0.25rem 0 0.35rem;
  }

  .wiki-loop-toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .wiki-loop-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, color 0.15s, border-color 0.15s, filter 0.15s;
  }

  .wiki-loop-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .wiki-loop-btn-primary {
    background: var(--accent);
    color: white;
    border-color: color-mix(in srgb, var(--accent) 80%, black);
  }

  .wiki-loop-btn-primary:hover:not(:disabled) {
    filter: brightness(1.07);
  }

  .wiki-loop-btn-secondary {
    background: transparent;
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 80%, transparent);
  }

  .wiki-loop-btn-secondary:hover:not(:disabled) {
    background: var(--bg-2);
  }

  .links-list {
    display: flex;
    flex-direction: column;
  }

  .link-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: padding-left 0.2s ease, color 0.15s;
  }

  .link-item:hover:not(.static):not(.disabled):not(:disabled) {
    padding-left: 4px;
    color: var(--accent);
  }

  .link-item.wiki-recent-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 1rem;
  }

  .link-info {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .status-pill {
    font-size: 0.625rem;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--bg-3);
    color: var(--text-2);
  }

  .status-pill.paused {
    background: color-mix(in srgb, var(--text-2) 22%, var(--bg-3));
    color: var(--text);
  }

  .link-status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .status-sub {
    font-size: 0.75rem;
    color: var(--text-2);
  }

  .status-syncing {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-weight: 600;
  }

  .sync-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    animation: hub-sync-pulse 1.2s ease-in-out infinite;
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

  .section-lead {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    line-height: 1.45;
    max-width: 40rem;
  }

  .section-lead-strong {
    font-weight: 650;
    color: var(--text);
  }

  .section-lead-settings-link {
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--text) 40%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .section-lead-settings-link:hover {
    text-decoration-color: var(--text);
  }

  .index-status-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.65rem 0 0.85rem;
    font-size: 0.8125rem;
    color: var(--text-2);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  }

  .index-status-primary {
    font-weight: 600;
    color: var(--text);
  }

  .index-status-err {
    color: var(--text-3);
    cursor: help;
  }

  .hub-sources-err {
    cursor: help;
  }

  .empty-msg {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    padding: 1rem 0;
  }

  .index-feed-summary {
    margin: 0;
    padding: 0.35rem 0 0;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--text);
  }

  .index-feed-summary-label {
    display: block;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    margin-bottom: 0.35rem;
  }

  .hub-sharing-err {
    color: var(--text);
  }

  .hub-share-block {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .hub-share-subhead {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: 0.02em;
  }

  .hub-share-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .hub-share-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem 1rem;
    padding: 0.65rem 0.75rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    background: color-mix(in srgb, var(--bg-2) 50%, transparent);
  }

  .hub-share-main {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }

  .hub-share-path code {
    font-size: 0.8125rem;
    word-break: break-all;
  }

  .hub-share-meta {
    font-size: 0.75rem;
    color: var(--text-2);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .hub-share-pill {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.12rem 0.35rem;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--text);
  }

  .hub-share-pill-muted {
    background: color-mix(in srgb, var(--border) 60%, transparent);
    color: var(--text-2);
  }

  .hub-share-btn {
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .hub-share-btn:hover:not(:disabled) {
    background: var(--bg-3);
  }

  .hub-share-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .hub-share-btn-primary {
    background: var(--accent);
    color: white;
    border-color: color-mix(in srgb, var(--accent) 80%, black);
  }

  .hub-share-btn-primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .hub-share-btn-danger {
    border-color: color-mix(in srgb, #c0392b 45%, var(--border));
    color: #e74c3c;
  }

  .hub-share-btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, #e74c3c 12%, transparent);
  }

  .hub-share-empty {
    padding: 0.5rem 0;
  }

  @media (max-width: 767px) {
    .hub-page {
      padding: 1.5rem 1rem;
    }
  }
</style>
