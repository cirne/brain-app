<script lang="ts">
  /**
   * Post–profile-accept seeding screen.
   *
   * Desktop: two columns — left: wiki education + CTA; right: live YourWikiDetail (same view as Hub).
   * Mobile: single column with a sticky status strip at the bottom showing the most recent activity.
   */
  import { onMount } from 'svelte'
  import { ArrowRight } from '@lucide/svelte'
  import { t } from '@client/lib/i18n/index.js'
  import type { BackgroundAgentDoc } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { startHubEventsConnection } from '@client/lib/hubEvents/hubEventsClient.js'
  import YourWikiDetail from '@components/YourWikiDetail.svelte'
  import { ONBOARDING_SEEDING_MIN_DWELL_MS } from '@client/lib/onboarding/seedConstants.js'

  type Props = {
    onContinue: () => void
    continueBusy: boolean
    errorText?: string | null
    multiTenant?: boolean
  }

  let { onContinue, continueBusy, errorText = null, multiTenant = false }: Props = $props()

  let wikiDoc = $state<BackgroundAgentDoc | null>(null)
  let dwellMet = $state(false)

  onMount(() => {
    /**
     * App renders either Onboarding or Assistant, not both — Assistant is what normally starts
     * `/api/events` (your_wiki SSE). This screen must start it too or the right-hand feed stays
     * empty until a full reload lands on the main app.
     */
    const stopHubEvents = startHubEventsConnection()

    void fetch('/api/your-wiki')
      .then((r) => (r.ok ? (r.json() as Promise<BackgroundAgentDoc>) : Promise.resolve(null)))
      .then((j) => {
        if (j?.id) yourWikiDocFromEvents.update((cur) => cur ?? j)
      })
      .catch(() => {})

    const unsub = yourWikiDocFromEvents.subscribe((d) => {
      if (d) wikiDoc = d
    })
    const timer = setTimeout(() => {
      dwellMet = true
    }, ONBOARDING_SEEDING_MIN_DWELL_MS)

    return () => {
      stopHubEvents()
      unsub()
      clearTimeout(timer)
    }
  })

  const canContinue = $derived(dwellMet)

  const isLive = $derived(
    wikiDoc?.phase === 'starting' ||
      wikiDoc?.phase === 'surveying' ||
      wikiDoc?.phase === 'enriching' ||
      wikiDoc?.phase === 'cleaning',
  )

  /** Real scrollport for the right column (content lives in a parent with max-height + overflow). */
  let seedPanelEl = $state<HTMLDivElement | undefined>(undefined)

  /** Compact one-liner for the mobile status strip. */
  const mobileStatus = $derived.by((): string => {
    const d = wikiDoc
    if (!d) return $t('onboarding.seedingInterstitial.mobileStatus.starting')
    if (d.detail?.trim()) return d.detail.trim()
    const timeline = d.timeline
    if (timeline && timeline.length > 0) {
      const last = [...timeline].sort((a, b) => b.at.localeCompare(a.at))[0]
      return last.toolName.replace(/_/g, ' ')
    }
    const phase = d.phase
    if (phase === 'starting') return $t('onboarding.seedingInterstitial.mobileStatus.starting')
    if (phase === 'surveying') return $t('onboarding.seedingInterstitial.mobileStatus.surveying')
    if (phase === 'enriching') return $t('onboarding.seedingInterstitial.mobileStatus.enriching')
    if (phase === 'cleaning') return $t('onboarding.seedingInterstitial.mobileStatus.cleaning')
    return $t('onboarding.common.working')
  })
</script>

<section
  class="seed-screen flex min-h-0 w-full flex-1 flex-col gap-4 box-border px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom,0px))] min-[900px]:flex-row min-[900px]:items-stretch min-[900px]:gap-8 min-[900px]:px-6 min-[900px]:pt-5 min-[900px]:pb-6"
  aria-labelledby="seed-title"
>
  <!-- Left / main: education + CTA -->
  <div
    class="seed-content flex min-h-0 flex-1 flex-col gap-6 max-[899px]:justify-between min-[900px]:flex-none min-[900px]:basis-[min(22rem,36%)] min-[900px]:max-w-[26rem]"
  >
    <div class="seed-text flex flex-col">
      <span class="ob-kicker">{$t('onboarding.seedingInterstitial.kicker')}</span>
      <h1 id="seed-title" class="ob-headline">{$t('onboarding.seedingInterstitial.title')}</h1>
      <p class="ob-lead">
        {$t('onboarding.seedingInterstitial.lead.beforeVault')}
        <strong>
          {multiTenant
            ? $t('onboarding.seedingInterstitial.lead.vaultHosted')
            : $t('onboarding.seedingInterstitial.lead.vaultDesktop')}
        </strong>. {$t('onboarding.seedingInterstitial.lead.afterVault')}
      </p>
      <ul
        class="seed-tips mt-5 ml-[1.1rem] flex list-disc flex-col gap-1.5 text-[0.9rem] leading-[1.55] text-foreground/80 [&>li]:pl-[0.2rem]"
      >
        <li>
          {$t('onboarding.seedingInterstitial.tips.askForPrefix')}
          <strong>{$t('onboarding.seedingInterstitial.tips.askForStrong')}</strong>
          {$t('onboarding.seedingInterstitial.tips.askForSuffix')}
        </li>
        <li>
          {$t('onboarding.seedingInterstitial.tips.researchPrefix')}
          <strong>{$t('onboarding.seedingInterstitial.tips.researchStrong')}</strong>
          {$t('onboarding.seedingInterstitial.tips.researchSuffix')}
        </li>
        <li>
          <strong>{$t('onboarding.seedingInterstitial.tips.shortNotesStrong')}</strong>
          {$t('onboarding.seedingInterstitial.tips.shortNotesSuffix')}
        </li>
      </ul>
    </div>

    <div class="seed-footer flex shrink-0 flex-col items-start gap-3">
      {#if errorText}
        <p class="ob-error" role="alert">{errorText}</p>
      {/if}
      <p
        class="seed-dwell m-0 min-h-[1.2em] text-[0.8125rem] text-muted"
        role="status"
        aria-live="polite"
      >
        {#if !canContinue}
          {$t('onboarding.seedingInterstitial.dwell.waiting')}
        {:else}
          {$t('onboarding.seedingInterstitial.dwell.ready')}
        {/if}
      </p>
      <button
        type="button"
        class="ob-btn-primary seed-cta justify-center max-[899px]:w-full"
        disabled={!canContinue || continueBusy}
        onclick={() => onContinue()}
      >
        {#if continueBusy}
          <span class="ob-spinner" aria-hidden="true"></span>
          {$t('onboarding.common.working')}
        {:else}
          {$t('onboarding.seedingInterstitial.continueButton')}
          <ArrowRight class="ob-btn-icon" size={16} strokeWidth={2} aria-hidden="true" />
        {/if}
      </button>
    </div>
  </div>

  <!-- Right: live hub view (desktop only, hidden on mobile via Tailwind) -->
  <div
    class="seed-hub hidden min-[900px]:flex min-[900px]:basis-0 min-[900px]:flex-1 min-[900px]:flex-col min-[900px]:self-stretch min-[900px]:min-w-0 min-[900px]:min-h-0 min-[900px]:overflow-auto min-[900px]:border min-[900px]:border-border min-[900px]:bg-surface-2"
    bind:this={seedPanelEl}
    aria-label={$t('onboarding.seedingInterstitial.yourWikiLabel')}
  >
    <p
      class="seed-hub-label m-0 shrink-0 border-b border-border px-4 pt-[0.6rem] pb-[0.4rem] text-[0.6875rem] font-bold tracking-[0.07em] text-muted uppercase"
    >
      {$t('onboarding.seedingInterstitial.yourWikiLabel')}
    </p>
    <YourWikiDetail
      hideSectionLead
      showLoopControls={false}
      autoScrollActivity
      shrinkToContent
      activityScrollContainer={seedPanelEl}
      onOpenWiki={() => {}}
    />
  </div>

  <!-- Mobile status strip (hidden on desktop via Tailwind) -->
  <div
    class="seed-bar flex min-w-0 shrink-0 items-center gap-2 overflow-hidden border border-border bg-surface-2 px-3.5 py-[0.6rem] min-[900px]:hidden"
    role="status"
    aria-live="polite"
  >
    {#if isLive}
      <span class="seed-bar-pulse" aria-hidden="true"></span>
    {/if}
    <span
      class="seed-bar-text min-w-0 flex-1 overflow-hidden text-[0.8125rem] text-foreground/80 text-ellipsis whitespace-nowrap"
    >
      {mobileStatus}
    </span>
    {#if wikiDoc?.pageCount}
      <span
        class="seed-bar-count shrink-0 text-xs text-muted whitespace-nowrap [font-variant-numeric:tabular-nums]"
      >
        {$t('nav.yourWiki.pageCount', { count: wikiDoc.pageCount })}
      </span>
    {/if}
  </div>
</section>

<style>
  /* Pulse animation cannot be expressed cleanly with utility classes — stays scoped here. */
  .seed-bar-pulse {
    width: 6px;
    height: 6px;
flex-shrink: 0;
    background: var(--accent);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 40%, transparent);
    animation: seed-bar-pulse 1.8s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .seed-bar-pulse {
      animation: none;
    }
  }

  @keyframes seed-bar-pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 40%, transparent);
    }
    50% {
      opacity: 0.75;
      box-shadow: 0 0 0 4px transparent;
    }
  }
</style>
