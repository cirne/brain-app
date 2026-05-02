<script lang="ts">
  import { onMount } from 'svelte'
  import { Sparkles } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import type { BackgroundAgentDoc } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import BackgroundAgentPanel from '@tw-components/statusBar/BackgroundAgentPanel.svelte'
  import { backgroundAgentsFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'

  type Props = {
    /** When set (e.g. from URL), that run is listed first. */
    focusAgentId?: string | undefined
    onOpenWiki: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_chat: string, _label: string) => void
  }

  let {
    focusAgentId,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenDraft,
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
    return backgroundAgentsFromEvents.subscribe((list) => {
      agents = list
    })
  })

  /** Hub action button recipe (used in expansion controls). */
  const hubBtn =
    'hub-dialog-btn inline-flex cursor-pointer items-center gap-[0.35rem] rounded-lg border border-transparent px-[0.9rem] py-[0.45rem] text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60'
  const hubBtnPrimary =
    'hub-dialog-btn-primary border-[color-mix(in_srgb,var(--accent)_80%,black)] bg-accent text-white hover:not-disabled:[filter:brightness(1.06)]'
  const hubBtnSecondary =
    'hub-dialog-btn-secondary border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-transparent text-foreground hover:not-disabled:bg-surface-2'

  function statusPillClass(status: string): string {
    return cn(
      'status-pill rounded bg-surface-3 px-2 py-[2px] text-[0.625rem] font-extrabold uppercase tracking-[0.05em] text-muted',
      status === 'running' && 'bg-accent text-white',
      status === 'queued' && 'bg-[color-mix(in_srgb,var(--accent)_55%,var(--bg-3))] text-foreground',
      status === 'paused' && 'bg-[color-mix(in_srgb,var(--text-2)_22%,var(--bg-3))] text-foreground',
    )
  }
</script>

<div class="hub-bg-agents-detail flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-5 pb-6 pt-4">
  <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-snug text-muted">
    Wiki expansion fills and updates your vault using your profile, indexed mail, optional Messages (when
    available), and public web research when that improves accuracy. Use a full pass for a broad overview or a continue
    pass to deepen or fix gaps after mail syncs.
  </p>
  <div class="expansion-actions flex flex-wrap items-center gap-2" role="group" aria-label="Wiki expansion">
    <button
      type="button"
      class={cn(hubBtn, hubBtnPrimary)}
      disabled={expansionBlocked || expansionLoading !== null}
      onclick={() => void startWikiExpansion('full')}
    >
      <Sparkles size={16} aria-hidden="true" />
      {expansionLoading === 'full' ? 'Starting…' : 'Full expansion'}
    </button>
    <button
      type="button"
      class={cn(hubBtn, hubBtnSecondary)}
      disabled={expansionBlocked || expansionLoading !== null}
      onclick={() => void startWikiExpansion('continue')}
    >
      {expansionLoading === 'continue' ? 'Starting…' : 'Continue pass'}
    </button>
  </div>
  {#if expansionBlocked}
    <p class="expansion-hint m-0 max-w-[40rem] text-[0.8125rem] leading-tight text-muted" role="status">
      A run is already in progress — you can follow it in the activity log below. When it finishes, you can start
      another pass.
    </p>
  {/if}
  <div class="agents-list flex flex-col">
    {#if listAgents.length > 0}
      {#each listAgents as agent (agent.id)}
        <div class="agent-item-container flex flex-col gap-4 border-b border-border py-5">
          <div class="agent-summary flex items-center justify-between">
            <div class="agent-info flex items-center gap-3">
              <span class={statusPillClass(agent.status)}>{agent.status}</span>
              <span class="agent-label text-base font-semibold">{agent.label || 'Wiki Expansion'}</span>
            </div>
            {#if agent.pageCount > 0}
              <span class="page-count text-sm tabular-nums text-muted">{agent.pageCount} pages</span>
            {/if}
          </div>
          {#if ['running', 'queued', 'paused'].includes(agent.status)}
            <BackgroundAgentPanel
              id={agent.id}
              embedInHubDetail
              {onOpenWiki}
              {onOpenFile}
              {onOpenEmail}
              {onOpenDraft}
              {onOpenFullInbox}
              {onSwitchToCalendar}
              {onOpenMessageThread}
            />
          {/if}
        </div>
      {/each}
    {:else}
      <p class="empty-msg m-0 py-4 text-[0.9375rem] text-muted">
        {#if agents.some((a) => a.status === 'completed')}
          No wiki expansion run in progress. Start a full or continue pass above when you want another pass.
        {:else}
          No wiki expansion runs yet. Start a full pass above after onboarding or when you want a fresh overview.
        {/if}
      </p>
    {/if}
  </div>
</div>
