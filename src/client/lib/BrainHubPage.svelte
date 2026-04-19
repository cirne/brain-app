<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { 
    FileText, 
    Clock, 
    User, 
    Mail, 
    RefreshCw, 
    ChevronRight,
    AlertCircle,
    Smartphone,
    Folder,
    Calendar,
    Layers
  } from 'lucide-svelte'
  import type { BackgroundAgentDoc } from './statusBar/backgroundAgentTypes.js'
  import BackgroundAgentPanel from './statusBar/BackgroundAgentPanel.svelte'
  import type { OnboardingMailStatus } from './onboarding/onboardingTypes.js'

  type HubRipmailSourceRow = {
    id: string
    kind: string
    displayName: string
    path: string | null
  }

  type Props = {
    onOpenWiki: (_path: string) => void
    onOpenFile: (_path: string) => void
    onOpenEmail: (_id: string, _subject?: string, _from?: string) => void
    onOpenFullInbox: () => void
    onSwitchToCalendar: (_date: string, _eventId?: string) => void
    onOpenMessageThread: (_chat: string, _label: string) => void
    onSync: () => Promise<void>
  }

  let { 
    onOpenWiki, 
    onOpenFile, 
    onOpenEmail, 
    onOpenFullInbox, 
    onSwitchToCalendar, 
    onOpenMessageThread
  }: Props = $props()

  let docCount = $state<number | null>(null)
  let recentDocs = $state<{ path: string; name: string; date: string }[]>([])
  let showAllRecent = $state(false)
  let agents = $state<BackgroundAgentDoc[]>([])
  let mailStatus = $state<OnboardingMailStatus | null>(null)
  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  let inspectDialogEl = $state<HTMLDialogElement | null>(null)
  let inspectSource = $state<HubRipmailSourceRow | null>(null)
  let removingSource = $state(false)

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

  async function openSourceInspect(s: HubRipmailSourceRow) {
    inspectSource = s
    await tick()
    inspectDialogEl?.showModal()
  }

  function closeSourceInspect() {
    inspectDialogEl?.close()
  }

  async function confirmRemoveSource() {
    if (!inspectSource) return
    const name = inspectSource.displayName
    if (
      !confirm(
        `Remove “${name}” from the search index?\n\nNothing is deleted on disk. Brain will stop searching this source.`,
      )
    ) {
      return
    }
    removingSource = true
    try {
      const res = await fetch('/api/hub/sources/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: inspectSource.id }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not remove source')
      }
      closeSourceInspect()
      inspectSource = null
      await fetchData()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not remove source')
    } finally {
      removingSource = false
    }
  }

  async function fetchData() {
    try {
      const limit = showAllRecent ? 30 : 5
      const [wikiRes, recentRes, agentsRes, mailRes, sourcesRes] = await Promise.all([
        fetch('/api/wiki'),
        fetch(`/api/wiki/recent?limit=${limit}`),
        fetch('/api/background/agents'),
        fetch('/api/onboarding/mail'),
        fetch('/api/hub/sources'),
      ])

      if (wikiRes.ok) {
        const docs = await wikiRes.json()
        docCount = Array.isArray(docs) ? docs.length : null
      }
      if (recentRes.ok) {
        const j = await recentRes.json()
        recentDocs = j.files || []
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
        <button class="link-item" onclick={() => onOpenWiki('me.md')}>
          <div class="link-info">
            <User size={16} />
            <span>Your Profile (me.md)</span>
          </div>
          <ChevronRight size={16} />
        </button>

        <button class="link-item" onclick={() => {
          const replace = false
          const hubActive = true
          import('../router.js').then(r => {
            r.navigate({ overlay: { type: 'phone-access' }, hubActive }, replace ? { replace: true } : undefined)
            window.dispatchEvent(new PopStateEvent('popstate'))
          })
        }}>
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
        Everything Brain searches lives here: mail accounts, calendars, and folders on disk. Open a row to
        inspect it or remove it from the index.
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
            <button type="button" class="link-item hub-source-row" onclick={() => openSourceInspect(s)}>
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

    <dialog
      class="hub-source-dialog"
      bind:this={inspectDialogEl}
      onclose={() => {
        inspectSource = null
        removingSource = false
      }}
    >
      {#if inspectSource}
        <div class="hub-source-dialog-inner">
          <h3 class="hub-source-dialog-title">{inspectSource.displayName}</h3>
          <dl class="hub-source-meta">
            <div class="hub-source-meta-row">
              <dt>Type</dt>
              <dd>{sourceKindLabel(inspectSource.kind)}</dd>
            </div>
            <div class="hub-source-meta-row">
              <dt>Source id</dt>
              <dd class="hub-source-id">{inspectSource.id}</dd>
            </div>
            {#if inspectSource.path}
              <div class="hub-source-meta-row">
                <dt>Path</dt>
                <dd class="hub-source-path">{inspectSource.path}</dd>
              </div>
            {/if}
          </dl>
          <div class="hub-source-dialog-actions">
            <button type="button" class="hub-dialog-btn hub-dialog-btn-secondary" onclick={() => closeSourceInspect()}>
              Close
            </button>
            <button
              type="button"
              class="hub-dialog-btn hub-dialog-btn-danger"
              disabled={removingSource}
              onclick={() => void confirmRemoveSource()}
            >
              {removingSource ? 'Removing…' : 'Remove from index'}
            </button>
          </div>
        </div>
      {/if}
    </dialog>

    <!-- Section 2: Wiki Summary -->
    <section class="hub-section stats-section">
      <div class="section-header">
        <AlertCircle size={18} />
        <h2>Wiki Summary</h2>
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

    <!-- Section 3: Recently Written -->
    <section class="hub-section recent-section">
      <div class="section-header">
        <Clock size={18} />
        <h2>Recently Written</h2>
      </div>
      <div class="recent-list">
        {#if recentDocs.length > 0}
          {#each recentDocs as doc (doc.path)}
            <button class="recent-item" onclick={() => onOpenWiki(doc.path)}>
              <div class="recent-info">
                <FileText size={14} />
                <span class="recent-name">{doc.path}</span>
              </div>
              <span class="recent-date">{formatRelativeDate(doc.date)}</span>
            </button>
          {/each}
          <button class="show-more-btn" onclick={() => showAllRecent = !showAllRecent}>
            {showAllRecent ? 'Show less' : 'Show more...'}
          </button>
        {:else}
          <p class="empty-msg">No recent documents found.</p>
        {/if}
      </div>
    </section>

    <!-- Section 4: Background Agents -->
    <section class="hub-section agents-section">
      <div class="section-header">
        <RefreshCw size={18} />
        <h2>Background Agents</h2>
      </div>
      <div class="agents-list">
        {#if agents.length > 0}
          {#each agents as agent (agent.id)}
            <div class="agent-item-container">
              <div class="agent-summary">
                <div class="agent-info">
                  <span class="status-pill {agent.status}">{agent.status}</span>
                  <span class="agent-label">{agent.label || 'Wiki Expansion'}</span>
                </div>
                {#if agent.pageCount > 0}
                  <span class="page-count">{agent.pageCount} pages</span>
                {/if}
              </div>
              {#if ['running', 'queued', 'paused'].includes(agent.status)}
                <div class="agent-panel-wrapper">
                  <BackgroundAgentPanel 
                    id={agent.id}
                    onOpenWiki={onOpenWiki}
                    onOpenFile={onOpenFile}
                    onOpenEmail={onOpenEmail}
                    onOpenFullInbox={onOpenFullInbox}
                    onSwitchToCalendar={onSwitchToCalendar}
                    onOpenMessageThread={onOpenMessageThread}
                  />
                </div>
              {/if}
            </div>
          {/each}
        {:else}
          <p class="empty-msg">No active background agents.</p>
        {/if}
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

  .recent-list, .links-list, .agents-list {
    display: flex;
    flex-direction: column;
  }

  .recent-item, .link-item {
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

  .recent-item:hover, .link-item:hover:not(.static):not(.disabled) {
    padding-left: 4px;
    color: var(--accent);
  }

  .recent-info, .link-info {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 0.9375rem;
    font-weight: 500;
    min-width: 0;
  }

  .recent-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-date {
    font-size: 0.8125rem;
    color: var(--text-2);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .show-more-btn {
    align-self: flex-start;
    background: transparent;
    border: none;
    color: var(--text-2);
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.75rem 0;
    cursor: pointer;
    transition: color 0.15s;
  }

  .show-more-btn:hover {
    color: var(--accent);
  }

  .agent-item-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.25rem 0;
    border-bottom: 1px solid var(--border);
  }

  .agent-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .agent-info {
    display: flex;
    align-items: center;
    gap: 12px;
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

  .agent-label {
    font-size: 1rem;
    font-weight: 600;
  }

  .page-count {
    font-size: 0.875rem;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }

  .agent-panel-wrapper {
    margin-top: 0.5rem;
    padding: 1rem;
    background: var(--bg-2);
    border-radius: 8px;
    max-height: 400px;
    overflow: auto;
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

  .hub-source-dialog {
    max-width: 26rem;
    width: calc(100vw - 2rem);
    margin: auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 16px 48px color-mix(in srgb, black 35%, transparent);
  }

  .hub-source-dialog::backdrop {
    background: color-mix(in srgb, black 45%, transparent);
  }

  .hub-source-dialog-inner {
    padding: 1.25rem 1.35rem 1.35rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .hub-source-dialog-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
  }

  .hub-source-meta {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .hub-source-meta-row {
    display: grid;
    grid-template-columns: 6.5rem 1fr;
    gap: 0.5rem 1rem;
    font-size: 0.875rem;
    align-items: baseline;
  }

  .hub-source-meta-row dt {
    margin: 0;
    font-weight: 600;
    color: var(--text-2);
  }

  .hub-source-meta-row dd {
    margin: 0;
    word-break: break-word;
  }

  .hub-source-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.8125rem;
    color: var(--text-2);
  }

  .hub-source-path {
    font-size: 0.8125rem;
    line-height: 1.35;
  }

  .hub-source-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .hub-dialog-btn {
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.45rem 0.9rem;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .hub-dialog-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .hub-dialog-btn-secondary {
    background: transparent;
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 80%, transparent);
  }

  .hub-dialog-btn-secondary:hover:not(:disabled) {
    background: var(--bg-2);
  }

  .hub-dialog-btn-danger {
    background: color-mix(in srgb, var(--danger) 14%, var(--bg));
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }

  .hub-dialog-btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 24%, var(--bg));
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
  }
</style>
