<script lang="ts">
  import { onMount } from 'svelte'
  import { BookOpen } from 'lucide-svelte'
  import type { BackgroundAgentDoc } from './statusBar/backgroundAgentTypes.js'

  type Props = {
    onOpen: () => void
  }

  let { onOpen }: Props = $props()

  let docCount = $state<number | null>(null)
  let agents = $state<BackgroundAgentDoc[]>([])

  const activeAgents = $derived(
    agents.filter((a) => ['queued', 'running', 'paused'].includes(a.status))
  )
  const isRunning = $derived(activeAgents.some(a => a.status === 'running' || a.status === 'queued'))
  const activeLabel = $derived(activeAgents[0]?.status === 'running' ? 'Building wiki...' : activeAgents[0]?.status === 'queued' ? 'Queued' : activeAgents[0]?.status === 'paused' ? 'Paused' : '')

  async function fetchData() {
    try {
      const [wikiRes, agentsRes] = await Promise.all([
        fetch('/api/wiki'),
        fetch('/api/background/agents')
      ])
      
      if (wikiRes.ok) {
        const docs = await wikiRes.json()
        docCount = Array.isArray(docs) ? docs.length : null
      }
      
      if (agentsRes.ok) {
        const j = await agentsRes.json()
        agents = Array.isArray(j.agents) ? j.agents : []
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
</script>

<button
  type="button"
  class="hub-widget"
  class:active={activeAgents.length > 0}
  onclick={onOpen}
  title={activeAgents.length > 0 ? `${activeLabel} (Click for Brain Hub)` : 'Brain Hub'}
>
  {#if activeAgents.length > 0}
    <div class="pulse-container">
      <span class="pulse-dot" class:running={isRunning}></span>
    </div>
    <span class="hub-label">{activeLabel}</span>
  {:else}
    <BookOpen size={15} strokeWidth={2} aria-hidden="true" />
    {#if docCount !== null}
      <span class="hub-count">{docCount}</span>
    {/if}
  {/if}
</button>

<style>
  .hub-widget {
    height: 100%;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
    transition: color 0.15s, background 0.15s;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }

  .hub-widget:hover {
    color: var(--text);
    background: var(--bg-3);
  }

  .hub-widget.active {
    color: var(--accent);
  }

  .hub-count {
    font-variant-numeric: tabular-nums;
  }

  .hub-label {
    font-size: 12px;
    font-weight: 600;
  }

  .pulse-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }

  .pulse-dot.running {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent);
    animation: hub-pulse 2s infinite;
  }

  @keyframes hub-pulse {
    0% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent);
    }
    70% {
      transform: scale(1);
      box-shadow: 0 0 0 6px transparent;
    }
    100% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse-dot.running {
      animation: none;
    }
  }
</style>
