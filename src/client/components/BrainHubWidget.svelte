<script lang="ts">
  import { onMount } from 'svelte'
  import { cn } from '@client/lib/cn.js'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import WikiPageCountIndicator from '@components/WikiPageCountIndicator.svelte'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import { t } from '@client/lib/i18n/index.js'

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
    if (phase === 'starting') return $t('hub.brainHubWidget.phases.starting')
    if (phase === 'enriching') return $t('hub.brainHubWidget.phases.enriching')
    if (phase === 'cleaning') return $t('hub.brainHubWidget.phases.cleaning')
    if (phase === 'paused') return $t('hub.brainHubWidget.phases.paused')
    return ''
  })

  const showActive = $derived(isRunning || isPaused)
  const displayCount = $derived(wikiDoc ? wikiDoc.pageCount : docCount)

  async function fetchWikiDocCount() {
    try {
      const wikiRes = await fetch('/api/wiki')
      if (wikiRes.ok) {
        docCount = parseWikiListApiBody(await wikiRes.json()).files.length
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
  class={cn(
    'hub-widget relative flex h-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 text-[13px] font-medium text-muted transition-colors duration-150 hover:bg-surface-3 hover:text-foreground',
    showActive && 'active text-accent',
  )}
  onclick={onOpen}
  title={showActive
    ? $t('hub.brainHubWidget.titleActive', { activeLabel })
    : $t('hub.brainHubWidget.title')}
>
  <WikiPageCountIndicator
    count={displayCount}
    showPulse={showActive}
    pulseAnimating={isRunning}
    hubControl
  />
</button>
