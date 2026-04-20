<script lang="ts">
  import { onMount } from 'svelte'
  import { 
    User, 
    Mail, 
    RefreshCw, 
    ChevronRight,
    AlertCircle,
    Smartphone,
    Folder,
    Calendar,
    Layers,
    CircleHelp,
  } from 'lucide-svelte'
  import type { BackgroundAgentDoc } from './statusBar/backgroundAgentTypes.js'
  import type { OnboardingMailStatus } from './onboarding/onboardingTypes.js'
  import type { NavigateOptions, Overlay } from '../router.js'

  type HubRipmailSourceRow = {
    id: string
    kind: string
    displayName: string
    path: string | null
  }

  type Props = {
    /** All hub drill-downs use the same overlay + `SlideOver` stack as the chat shell. */
    onHubNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
  }

  let { onHubNavigate }: Props = $props()

  let docCount = $state<number | null>(null)
  let agents = $state<BackgroundAgentDoc[]>([])
  let mailStatus = $state<OnboardingMailStatus | null>(null)
  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  const agentsActiveDoc = $derived(
    agents.find((a) => ['running', 'queued', 'paused'].includes(a.status)) ?? null,
  )

  const agentsHubSummarySub = $derived.by(() => {
    const a = agentsActiveDoc
    if (a?.status === 'running' || a?.status === 'queued') {
      return `${a.label || 'Wiki expansion'} · in progress`
    }
    if (a?.status === 'paused') {
      return `${a.label || 'Wiki expansion'} · paused`
    }
    if (agents.length === 0) {
      return 'Open for wiki expansion controls'
    }
    return 'Idle — open for controls and history'
  })

  function sourceKindLabel(kind: string): string {
    switch (kind) {
      case 'imap':
        return 'Email (IMAP)'
      case 'applemail':
        return 'Apple Mail'
      case 'localDir':
        return 'Local folder'
      case 'googleCalendar':
        return 'Google Calendar'
      case 'appleCalendar':
        return 'Apple Calendar'
      case 'icsSubscription':
        return 'Subscribed calendar'
      case 'icsFile':
        return 'Calendar file'
      default:
        return kind
    }
  }

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

  function sourceRowSecondary(s: HubRipmailSourceRow): string {
    const k = sourceKindLabel(s.kind)
    if (s.path) return `${k} · ${s.path}`
    return k
  }

  const orderedHubSources = $derived(
    [...hubSources].sort((a, b) => {
      const t = sourceTier(a.kind) - sourceTier(b.kind)
      if (t !== 0) return t
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    }),
  )

  async function fetchData() {
    try {
      const [wikiRes, agentsRes, mailRes, sourcesRes] = await Promise.all([
        fetch('/api/wiki'),
        fetch('/api/background/agents'),
        fetch('/api/onboarding/mail'),
        fetch('/api/hub/sources'),
      ])

      if (wikiRes.ok) {
        const docs = await wikiRes.json()
        docCount = Array.isArray(docs) ? docs.length : null
      }
      if (agentsRes.ok) {
        const j = await agentsRes.json()
        agents = Array.isArray(j.agents) ? j.agents : []
      }
      if (mailRes.ok) {
        mailStatus = await mailRes.json()
      }
      if (sourcesRes.ok) {
        const j = (await sourcesRes.json()) as { sources?: HubRipmailSourceRow[]; error?: string }
        hubSources = Array.isArray(j.sources) ? j.sources : []
        hubSourcesError = typeof j.error === 'string' && j.error.trim() ? j.error : null
      }
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    void fetchData()
    const id = setInterval(() => void fetchData(), 2000)
    return () => clearInterval(id)
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

  /** Shown next to “Syncing…” when lock age ≥ 1m (subtle progress hint). */
  function formatSyncLockAge(ms: number | null): string {
    if (ms == null || ms < 60_000) return ''
    const m = Math.floor(ms / 60_000)
    if (m < 60) return ` · ${m}m`
    const h = Math.floor(m / 60)
    return ` · ${h}h`
  }
</script>

<div class="hub-page">
  <header class="hub-header">
    <div class="hub-header-content">
      <h1>Brain Hub</h1>
      <p class="hub-subtitle">Admin, settings, and system status</p>
    </div>
  </header>

  <div class="hub-grid">
    <!-- Section 1: Connectivity & Access -->
    <section class="hub-section links-section">
      <div class="section-header">
        <Smartphone size={18} />
        <h2>Access & Connectivity</h2>
      </div>
      <div class="links-list">
        <button class="link-item" onclick={() => onHubNavigate({ type: 'wiki', path: 'me.md' })}>
          <div class="link-info">
            <User size={16} />
            <span>Your Profile (me.md)</span>
          </div>
          <ChevronRight size={16} />
        </button>

        <button class="link-item" onclick={() => onHubNavigate({ type: 'phone-access' })}>
          <div class="link-info">
            <Smartphone size={16} />
            <span>Phone Access</span>
          </div>
          <div class="link-status">
            <span class="status-sub">Scan QR code</span>
          </div>
          <ChevronRight size={16} />
        </button>
      </div>
    </section>

    <section class="hub-section search-index-section">
      <div class="section-header">
        <Layers size={18} />
        <h2>Search index</h2>
      </div>
      <p class="section-lead">
        Everything Brain searches lives here: mail accounts, calendars, and your documents.
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
      <div class="links-list">
        {#if hubSourcesError}
          <p class="empty-msg hub-sources-err" title={hubSourcesError}>Could not load sources.</p>
        {:else if orderedHubSources.length === 0}
          <p class="empty-msg">No sources yet. Connect mail, add calendars, or add folders from chat.</p>
        {:else}
          {#each orderedHubSources as s (s.id)}
            <button
              type="button"
              class="link-item hub-source-row"
              onclick={() => onHubNavigate({ type: 'hub-source', id: s.id })}
            >
              <div class="link-info">
                {#if s.kind === 'localDir'}
                  <span class="hub-source-icon-wrap" aria-hidden="true"><Folder size={16} /></span>
                {:else if s.kind === 'imap' || s.kind === 'applemail'}
                  <span class="hub-source-icon-wrap" aria-hidden="true"><Mail size={16} /></span>
                {:else}
                  <span class="hub-source-icon-wrap" aria-hidden="true"><Calendar size={16} /></span>
                {/if}
                <div class="source-folder-text">
                  <span class="source-folder-name">{s.displayName}</span>
                  <span class="source-folder-path">{sourceRowSecondary(s)}</span>
                </div>
              </div>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          {/each}
        {/if}
      </div>
    </section>

    <!-- Section 2: Wiki Summary -->
    <section class="hub-section stats-section">
      <div class="section-header stats-section-header">
        <div class="stats-header-start">
          <AlertCircle size={18} />
          <h2>Wiki Summary</h2>
        </div>
        <button
          type="button"
          class="wiki-help-inline"
          onclick={() => onHubNavigate({ type: 'hub-wiki-about' })}
          title="How your wiki works with Brain"
          aria-label="What is the wiki? Opens help."
        >
          <CircleHelp size={16} strokeWidth={2} aria-hidden="true" />
          <span>What is this?</span>
        </button>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-value">{docCount ?? '--'}</span>
          <span class="stat-label">Documents</span>
        </div>
        <div class="stat-card">
          <span class="stat-value"
            >{mailStatus?.lastSyncedAt ? formatRelativeDate(mailStatus.lastSyncedAt) : '--'}</span
          >
          <span class="stat-label stat-label-sentence">last sync</span>
        </div>
      </div>
    </section>

    <!-- Section 3: Background Agents — open detail in right pane (same as wiki / phone access) -->
    <section class="hub-section agents-section" aria-label="Background agents">
      <div class="section-header">
        <RefreshCw size={18} />
        <h2>Background Agents</h2>
      </div>
      <div class="links-list">
        <button
          type="button"
          class="link-item hub-source-row"
          onclick={() =>
            onHubNavigate(
              agentsActiveDoc
                ? { type: 'background-agent', id: agentsActiveDoc.id }
                : { type: 'background-agent' },
            )}
        >
          <div class="link-info">
            <span class="hub-source-icon-wrap" aria-hidden="true"><RefreshCw size={16} /></span>
            <div class="source-folder-text">
              <span class="source-folder-name">Wiki expansion</span>
              <span class="source-folder-path">{agentsHubSummarySub}</span>
            </div>
          </div>
          {#if agentsActiveDoc && (agentsActiveDoc.status === 'running' || agentsActiveDoc.status === 'queued')}
            <div class="link-status">
              <span class="status-pill {agentsActiveDoc.status}">{agentsActiveDoc.status}</span>
            </div>
          {:else if agentsActiveDoc?.status === 'paused'}
            <div class="link-status">
              <span class="status-pill paused">{agentsActiveDoc.status}</span>
            </div>
          {/if}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
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

  .hub-subtitle {
    margin: 0.5rem 0 0;
    color: var(--text-2);
    font-size: 1rem;
    font-weight: 450;
  }

  .hub-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 3.5rem;
  }

  .hub-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .stats-section {
    gap: 0.6rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text);
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .stats-section-header {
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .stats-header-start {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .wiki-help-inline {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
    margin-left: auto;
    padding: 0.25rem 0.4rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-2);
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .wiki-help-inline:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 9%, var(--bg));
  }

  .stats-section .stats-grid {
    gap: 2rem;
  }

  h2 {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .stats-grid {
    display: flex;
    gap: 3rem;
  }

  .stat-card {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .stat-value {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-2);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-label-sentence {
    text-transform: none;
    letter-spacing: 0.01em;
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

  .link-item:hover:not(.static):not(.disabled) {
    padding-left: 4px;
    color: var(--accent);
  }

  .link-info {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 0.9375rem;
    font-weight: 500;
    min-width: 0;
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

  .status-pill.running {
    background: var(--accent);
    color: white;
  }

  .status-pill.queued {
    background: color-mix(in srgb, var(--accent) 55%, var(--bg-3));
    color: var(--text);
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

  .status-val {
    font-size: 0.875rem;
    font-weight: 600;
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

  .status-mail-err {
    color: var(--text-3);
  }

  .section-lead {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    line-height: 1.45;
    max-width: 40rem;
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

  .hub-source-row .link-info {
    align-items: flex-start;
  }

  .hub-source-icon-wrap {
    display: flex;
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--text-2);
  }

  .source-folder-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .source-folder-name {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text);
  }

  .source-folder-path {
    font-size: 0.8125rem;
    color: var(--text-2);
    word-break: break-word;
    line-height: 1.35;
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

  @media (max-width: 767px) {
    .hub-page {
      padding: 1.5rem 1rem;
    }
    .stats-grid {
      gap: 1.5rem;
    }
    .stats-section .stats-grid {
      gap: 1.25rem;
    }
  }
</style>
