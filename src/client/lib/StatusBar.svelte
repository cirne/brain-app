<script lang="ts">
  import { onMount } from 'svelte'
  import { navigate, parseRoute } from '../router.js'
  import type { BackgroundAgentDoc } from './statusBar/backgroundAgentTypes.js'
  import WikiFileName from './WikiFileName.svelte'
  import { Loader2 } from 'lucide-svelte'

  type Props = {
    onExpansionRunningChange?: (_running: boolean) => void
    /** Keep shell `route` in sync after `navigate()` (pushState does not fire popstate). */
    onAfterNavigate?: () => void
  }

  let { onExpansionRunningChange, onAfterNavigate }: Props = $props()

  let agents = $state<BackgroundAgentDoc[]>([])

  const visibleAgents = $derived(
    agents.filter((a) => ['queued', 'running', 'paused'].includes(a.status)),
  )

  $effect(() => {
    onExpansionRunningChange?.(visibleAgents.length > 0)
  })

  async function fetchAgents() {
    try {
      const res = await fetch('/api/background/agents')
      if (!res.ok) return
      const j = (await res.json()) as { agents?: BackgroundAgentDoc[] }
      agents = Array.isArray(j.agents) ? j.agents : []
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    void fetchAgents()
    const id = setInterval(() => void fetchAgents(), 2000)
    return () => clearInterval(id)
  })

  /** Wiki-relative path last touched (write/edit), preferring server field, else latest structured log, else legacy log lines. */
  function latestTouchedWikiPath(a: BackgroundAgentDoc): string | null {
    const direct = typeof a.lastWikiPath === 'string' ? a.lastWikiPath.trim() : ''
    if (direct) return direct
    const entries = a.logEntries
    if (entries?.length) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]
        const d = typeof e.detail === 'string' ? e.detail.trim() : ''
        if (d && (e.verb === 'Created' || e.verb === 'Updated')) return d
      }
    }
    for (let i = a.logLines.length - 1; i >= 0; i--) {
      const line = a.logLines[i].trim()
      const m = line.match(/^Wrote (.+)$/) ?? line.match(/^Edited (.+)$/)
      if (m?.[1]) return m[1].trim()
    }
    return null
  }

  /** Short status (not the streaming detail line). */
  function expansionStatusLabel(a: BackgroundAgentDoc): string {
    if (a.status === 'queued') return 'Queued'
    if (a.status === 'paused') return 'Paused'
    if (a.status === 'running') return 'Building wiki'
    return a.label?.trim() || 'Wiki expansion'
  }

  function wikiStatusGroupAriaLabel(a: BackgroundAgentDoc): string {
    const path = latestTouchedWikiPath(a)
    const status = expansionStatusLabel(a)
    const pages = a.pageCount > 0 ? `${a.pageCount} pages created. ` : ''
    const file = path ? `Latest file: ${path}. ` : ''
    return `${pages}${file}Status: ${status}. Use Tab to focus the file name to open it in docs, or the status area for expansion details.`
      .replace(/\s+/g, ' ')
      .trim()
  }

  function openExpansionPanel(id: string) {
    navigate({ overlay: { type: 'background-agent', id } })
    onAfterNavigate?.()
  }

  function openWikiPath(path: string) {
    const cur = parseRoute()
    const replace = cur.overlay?.type === 'wiki'
    navigate({ overlay: { type: 'wiki', path } }, replace ? { replace: true } : undefined)
    onAfterNavigate?.()
  }

  function onSummaryKeydown(e: KeyboardEvent, runId: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openExpansionPanel(runId)
    }
  }

  function onFileKeydown(e: KeyboardEvent, path: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openWikiPath(path)
    }
  }
</script>

{#if visibleAgents.length > 0}
  <div class="app-status-bar" role="status" aria-label="Background tasks">
    {#each visibleAgents as a (a.id)}
      {@const wikiPath = latestTouchedWikiPath(a)}
      <div
        class="status-chip"
        role="group"
        aria-label={wikiStatusGroupAriaLabel(a)}
      >
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="status-chip-summary"
          tabindex="0"
          title={a.detail?.trim() || expansionStatusLabel(a)}
          onclick={() => openExpansionPanel(a.id)}
          onkeydown={(e) => onSummaryKeydown(e, a.id)}
        >
          {#if a.status === 'running' || a.status === 'queued'}
            <span class="status-chip-spinner" aria-hidden="true">
              <Loader2 size={14} />
            </span>
          {/if}
          <span class="status-chip-label">{expansionStatusLabel(a)}</span>
          {#if a.pageCount > 0}
            <span class="status-chip-count" title="Pages created (excluding me.md)">{a.pageCount}</span>
          {/if}
        </div>
        {#if wikiPath}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="status-chip-file"
            tabindex="0"
            title="Open {wikiPath} in docs"
            onclick={(e) => {
              e.stopPropagation()
              openWikiPath(wikiPath)
            }}
            onkeydown={(e) => onFileKeydown(e, wikiPath)}
          >
            <WikiFileName path={wikiPath} />
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .app-status-bar {
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-2) 88%, var(--bg));
    min-height: 2.25rem;
  }

  .status-chip {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    max-width: 100%;
  }

  .status-chip-summary {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.55rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    background: color-mix(in srgb, var(--bg) 92%, var(--border));
    color: var(--text);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    outline: none;
    transition: background 0.12s, border-color 0.12s;
  }
  .status-chip-summary:hover {
    background: color-mix(in srgb, var(--bg-2) 85%, var(--text) 4%);
    border-color: color-mix(in srgb, var(--border) 85%, var(--text));
  }
  .status-chip-summary:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .status-chip-file {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    max-width: min(60vw, 20rem);
    padding: 0.1rem 0.45rem;
    border-radius: 0.45rem;
    border: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
    background: color-mix(in srgb, var(--bg-2) 82%, var(--bg));
    cursor: pointer;
    outline: none;
    transition: background 0.12s, border-color 0.12s;
    color: var(--text);
  }
  .status-chip-file:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: color-mix(in srgb, var(--bg-2) 72%, var(--accent));
  }
  .status-chip-file:focus-visible {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .status-chip-file :global(.wfn-title-row) {
    font-size: 0.75rem;
    line-height: 1.25;
  }

  .status-chip-spinner {
    flex-shrink: 0;
    display: inline-flex;
    animation: status-spin 0.9s linear infinite;
  }

  @keyframes status-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status-chip-spinner {
      animation: none;
    }
  }

  .status-chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-chip-count {
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
  }
</style>
