<script lang="ts">
  import { onMount } from 'svelte'
  import { 
    FileText, 
    Clock, 
    User, 
    Mail, 
    RefreshCw, 
    ChevronRight,
    AlertCircle,
    Smartphone
  } from 'lucide-svelte'
  import type { BackgroundAgentDoc } from './statusBar/backgroundAgentTypes.js'
  import BackgroundAgentPanel from './statusBar/BackgroundAgentPanel.svelte'

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
  let mailStatus = $state<{ indexedTotal: number; lastSyncedAt: string | null; syncRunning: boolean } | null>(null)
  let lastEdit = $state<{ path: string; date: string } | null>(null)

  async function fetchData() {
    try {
      const limit = showAllRecent ? 30 : 5
      const [wikiRes, recentRes, agentsRes, mailRes, historyRes] = await Promise.all([
        fetch('/api/wiki'),
        fetch(`/api/wiki/recent?limit=${limit}`),
        fetch('/api/background/agents'),
        fetch('/api/onboarding/mail'),
        fetch('/api/wiki/edit-history?limit=1')
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
      if (historyRes.ok) {
        const j = await historyRes.json()
        lastEdit = j.files?.[0] || null
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
        
        <div class="link-item static">
          <div class="link-info">
            <Mail size={16} />
            <span>Email Index</span>
          </div>
          <div class="link-status">
            {#if mailStatus}
              <span class="status-val">{mailStatus.indexedTotal} indexed</span>
              {#if mailStatus.lastSyncedAt}
                <span class="status-sub">Last: {formatRelativeDate(mailStatus.lastSyncedAt)}</span>
              {/if}
            {:else}
              <span class="status-val">Loading...</span>
            {/if}
          </div>
        </div>

        <div class="link-item disabled">
          <div class="link-info">
            <span>Data Sources (OPP-021)</span>
          </div>
          <span class="coming-soon">Coming soon</span>
        </div>
      </div>
    </section>

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
          <span class="stat-value">{lastEdit ? formatRelativeDate(lastEdit.date) : '--'}</span>
          <span class="stat-label">Last Agent Edit</span>
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
          {#each recentDocs as doc}
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
          {#each agents as agent}
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

  .disabled {
    opacity: 0.4;
    cursor: default;
  }

  .coming-soon {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-3);
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
