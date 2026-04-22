<script lang="ts">
  import { onMount } from 'svelte'
  import { BookOpen } from 'lucide-svelte'
  import type { BackgroundAgentDoc, YourWikiPhase } from './statusBar/backgroundAgentTypes.js'
  import { subscribe } from './app/appEvents.js'
  import { yourWikiDocFromEvents } from './hubEvents/hubEventsStores.js'

  type Props = {
    onOpen: () => void
  }

  let { onOpen }: Props = $props()

  let docCount = $state<number | null>(null)
  let wikiDoc = $state<BackgroundAgentDoc | null>(null)

  const phase = $derived(wikiDoc?.phase as YourWikiPhase | undefined)
  const isRunning = $derived(phase === 'starting' || phase === 'enriching' || phase === 'cleaning')
  const isPaused = $derived(phase === 'paused')

  const activeLabel = $derived.by((): string => {
    if (phase === 'starting') return 'Starting wiki…'
    if (phase === 'enriching') return 'Enriching…'
    if (phase === 'cleaning') return 'Cleaning up…'
    if (phase === 'paused') return 'Paused'
    return ''
  })

  const showActive = $derived(isRunning || isPaused)
  const displayCount = $derived(wikiDoc ? wikiDoc.pageCount : docCount)

  async function fetchWikiDocCount() {
    try {
      const wikiRes = await fetch('/api/wiki')
      if (wikiRes.ok) {
        const docs = await wikiRes.json()
        docCount = Array.isArray(docs) ? docs.length : null
      }
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    void fetchWikiDocCount()
    const unsubStore = yourWikiDocFromEvents.subscribe((d) => {
      if (d) wikiDoc = d
    })
    const unsubEvents = subscribe((e) => {
      if (e.type === 'wiki:mutated' || e.type === 'sync:completed') void fetchWikiDocCount()
    })
    return () => {
      unsubStore()
      unsubEvents()
    }
  })
</script>

<button
  type="button"
  class="hub-widget"
  class:active={showActive}
  onclick={onOpen}
  title={showActive ? `${activeLabel} (Click for Braintunnel Hub)` : 'Braintunnel Hub'}
>
  {#if showActive}
    <div class="pulse-container">
      <span class="pulse-dot" class:running={isRunning}></span>
    </div>
    {#if displayCount !== null}
      <span class="hub-count">{displayCount}</span>
    {/if}
  {:else}
    <BookOpen size={15} strokeWidth={2} aria-hidden="true" />
    {#if displayCount !== null}
      <span class="hub-count">{displayCount}</span>
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
