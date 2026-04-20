<script lang="ts">
  import { onMount } from 'svelte'
  import { Sparkles } from 'lucide-svelte'
  import type { BackgroundAgentDoc } from './statusBar/backgroundAgentTypes.js'
  import BackgroundAgentPanel from './statusBar/BackgroundAgentPanel.svelte'

  type Props = {
    /** When set (e.g. from URL), that run is listed first. */
    focusAgentId?: string | undefined
    onOpenWiki: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_chat: string, _label: string) => void
  }

  let {
    focusAgentId,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
  }: Props = $props()

  let agents = $state<BackgroundAgentDoc[]>([])
  let expansionLoading = $state<'full' | 'continue' | null>(null)

  const expansionBlocked = $derived(
    agents.some((a) => a.status === 'running' || a.status === 'queued'),
  )

  const displayAgents = $derived.by(() => {
    if (!focusAgentId) return agents
    const ix = agents.findIndex((a) => a.id === focusAgentId)
    if (ix <= 0) return agents
    const next = [...agents]
    const [one] = next.splice(ix, 1)
    return [one, ...next]
  })

  /** Omit finished runs — only the live activity feed belongs in this panel. */
  const listAgents = $derived(displayAgents.filter((a) => a.status !== 'completed'))

  async function startWikiExpansion(mode: 'full' | 'continue') {
    if (expansionBlocked || expansionLoading) return
    expansionLoading = mode
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const res = await fetch('/api/background/wiki-expansion/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode === 'continue' ? 'continue' : 'full', timezone }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not start wiki expansion')
      }
      await fetchAgents()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not start wiki expansion')
    } finally {
      expansionLoading = null
    }
  }

  async function fetchAgents() {
    try {
      const agentsRes = await fetch('/api/background/agents')
      if (agentsRes.ok) {
        const j = await agentsRes.json()
        agents = Array.isArray(j.agents) ? j.agents : []
      }
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    void fetchAgents()
    const id = setInterval(() => void fetchAgents(), 2000)
    return () => clearInterval(id)
  })
</script>

<div class="hub-bg-agents-detail">
  <p class="section-lead">
    Wiki expansion fills and updates your vault using your profile, indexed mail, optional Messages on this Mac,
    and public web research when that improves accuracy. Use a full pass for a broad overview or a continue
    pass to deepen or fix gaps after mail syncs.
  </p>
  <div class="expansion-actions" role="group" aria-label="Wiki expansion">
    <button
      type="button"
      class="hub-dialog-btn hub-dialog-btn-primary"
      disabled={expansionBlocked || expansionLoading !== null}
      onclick={() => void startWikiExpansion('full')}
    >
      <Sparkles size={16} aria-hidden="true" />
      {expansionLoading === 'full' ? 'Starting…' : 'Full expansion'}
    </button>
    <button
      type="button"
      class="hub-dialog-btn hub-dialog-btn-secondary"
      disabled={expansionBlocked || expansionLoading !== null}
      onclick={() => void startWikiExpansion('continue')}
    >
      {expansionLoading === 'continue' ? 'Starting…' : 'Continue pass'}
    </button>
  </div>
  {#if expansionBlocked}
    <p class="expansion-hint" role="status">
      A run is already in progress — you can follow it in the activity log below. When it finishes, you can start
      another pass.
    </p>
  {/if}
  <div class="agents-list">
    {#if listAgents.length > 0}
      {#each listAgents as agent (agent.id)}
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
            <BackgroundAgentPanel
              id={agent.id}
              embedInHubDetail
              {onOpenWiki}
              {onOpenFile}
              {onOpenEmail}
              {onOpenFullInbox}
              {onSwitchToCalendar}
              {onOpenMessageThread}
            />
          {/if}
        </div>
      {/each}
    {:else}
      <p class="empty-msg">
        {#if agents.some((a) => a.status === 'completed')}
          No wiki expansion run in progress. Start a full or continue pass above when you want another pass.
        {:else}
          No wiki expansion runs yet. Start a full pass above after onboarding or when you want a fresh overview.
        {/if}
      </p>
    {/if}
  </div>
</div>

<style>
  .hub-bg-agents-detail {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1rem 1.25rem 1.5rem;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }

  .section-lead {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    line-height: 1.45;
    max-width: 40rem;
  }

  .expansion-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .expansion-actions .hub-dialog-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .expansion-hint {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-2);
    line-height: 1.4;
    max-width: 40rem;
  }

  .agents-list {
    display: flex;
    flex-direction: column;
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

  .status-pill.queued {
    background: color-mix(in srgb, var(--accent) 55%, var(--bg-3));
    color: var(--text);
  }

  .status-pill.paused {
    background: color-mix(in srgb, var(--text-2) 22%, var(--bg-3));
    color: var(--text);
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

  .hub-dialog-btn-primary {
    background: var(--accent);
    color: white;
    border-color: color-mix(in srgb, var(--accent) 80%, black);
  }

  .hub-dialog-btn-primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .empty-msg {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    padding: 1rem 0;
  }
</style>
