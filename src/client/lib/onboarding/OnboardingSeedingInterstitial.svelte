<script lang="ts">
  /**
   * Post–profile-accept seeding screen.
   *
   * Desktop: two columns — left: wiki education + CTA; right: live YourWikiDetail (same view as Hub).
   * Mobile: single column with a sticky status strip at the bottom showing the most recent activity.
   */
  import { onMount } from 'svelte'
  import type { BackgroundAgentDoc } from '../statusBar/backgroundAgentTypes.js'
  import { yourWikiDocFromEvents } from '../hubEvents/hubEventsStores.js'
  import YourWikiDetail from '../YourWikiDetail.svelte'
  import { ONBOARDING_SEEDING_MIN_DWELL_MS } from './seedConstants.js'

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
      unsub()
      clearTimeout(timer)
    }
  })

  const canContinue = $derived(dwellMet)

  const isLive = $derived(
    wikiDoc?.phase === 'starting' ||
      wikiDoc?.phase === 'enriching' ||
      wikiDoc?.phase === 'cleaning',
  )

  /** Real scrollport for the right column (content lives in a parent with max-height + overflow). */
  let seedPanelEl = $state<HTMLDivElement | undefined>(undefined)

  /** Compact one-liner for the mobile status strip. */
  const mobileStatus = $derived.by((): string => {
    const d = wikiDoc
    if (!d) return 'Starting…'
    if (d.detail?.trim()) return d.detail.trim()
    const t = d.timeline
    if (t && t.length > 0) {
      const last = [...t].sort((a, b) => b.at.localeCompare(a.at))[0]
      return last.toolName.replace(/_/g, ' ')
    }
    const phase = d.phase
    if (phase === 'starting') return 'Starting…'
    if (phase === 'enriching') return 'Enriching pages…'
    if (phase === 'cleaning') return 'Cleaning up…'
    return 'Working…'
  })
</script>

<section class="seed-screen" aria-labelledby="seed-title">
  <!-- Left / main: education + CTA -->
  <div class="seed-content">
    <div class="seed-text">
      <span class="ob-kicker">Braintunnel</span>
      <h1 id="seed-title" class="ob-headline">We're building your wiki</h1>
      <p class="ob-lead">
        Your wiki is linked pages in
        <strong>{multiTenant ? 'your vault' : 'your vault on this Mac'}</strong>. They give
        Braintunnel lasting context—people, projects, and what you've already written—so you don't
        start from zero every chat.
      </p>
      <ul class="seed-tips">
        <li>Ask for <strong>a new page</strong> for a person, project, or idea.</li>
        <li>
          Say <strong>"Research this and add it to the wiki,"</strong> then edit the page if you
          like.
        </li>
        <li><strong>Short notes are fine</strong>—linking pages matters more than length.</li>
      </ul>
    </div>

    <div class="seed-footer">
      {#if errorText}
        <p class="ob-error" role="alert">{errorText}</p>
      {/if}
      <p class="seed-dwell" role="status" aria-live="polite">
        {#if !canContinue}
          A few more seconds to let the first pages land…
        {:else}
          You can continue whenever you're ready.
        {/if}
      </p>
      <button
        type="button"
        class="ob-btn-primary seed-cta"
        disabled={!canContinue || continueBusy}
        onclick={() => onContinue()}
      >
        {#if continueBusy}
          <span class="ob-spinner" aria-hidden="true"></span>
          Working…
        {:else}
          Continue to Braintunnel
          <svg
            class="ob-btn-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
          </svg>
        {/if}
      </button>
    </div>
  </div>

  <!-- Right: live hub view (desktop only, hidden on mobile via CSS) -->
  <div class="seed-hub" bind:this={seedPanelEl} aria-label="Your Wiki">
    <p class="seed-hub-label">Your Wiki</p>
    <YourWikiDetail
      hideSectionLead
      showLoopControls={false}
      autoScrollActivity
      shrinkToContent
      activityScrollContainer={seedPanelEl}
      onOpenWiki={() => {}}
    />
  </div>

  <!-- Mobile status strip (hidden on desktop via CSS) -->
  <div class="seed-bar" role="status" aria-live="polite">
    {#if isLive}
      <span class="seed-bar-pulse" aria-hidden="true"></span>
    {/if}
    <span class="seed-bar-text">{mobileStatus}</span>
    {#if wikiDoc?.pageCount}
      <span class="seed-bar-count">{wikiDoc.pageCount} pages</span>
    {/if}
  </div>
</section>

<style>
  .seed-screen {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    padding: 1.25rem 1.25rem max(1rem, env(safe-area-inset-bottom, 0px));
    box-sizing: border-box;
    gap: 1rem;
  }

  @media (min-width: 900px) {
    .seed-screen {
      flex-direction: row;
      padding: 1.25rem 1.5rem 1.5rem;
      /* Match the main column’s height so the right “Your Wiki” panel fills the viewport. */
      align-items: stretch;
      gap: 2rem;
    }
  }

  /* Left column: fills height on mobile, fixed width on desktop */
  .seed-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: 1.5rem;
  }

  @media (max-width: 899px) {
    .seed-content {
      justify-content: space-between;
    }
  }

  @media (min-width: 900px) {
    .seed-content {
      flex: 0 0 min(22rem, 36%);
      max-width: 26rem;
    }
  }

  .seed-text {
    display: flex;
    flex-direction: column;
  }

  .seed-tips {
    margin: 1.25rem 0 0 1.1rem;
    padding: 0;
    list-style: disc;
    font-size: 0.9rem;
    line-height: 1.55;
    color: var(--text-2);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .seed-tips li {
    padding-left: 0.2rem;
  }

  .seed-footer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .seed-dwell {
    font-size: 0.8125rem;
    color: var(--text-3, var(--text-2));
    margin: 0;
    min-height: 1.2em;
  }

  .seed-cta {
    justify-content: center;
  }

  @media (max-width: 899px) {
    .seed-cta {
      width: 100%;
    }
  }

  /* Right hub panel: desktop only */
  .seed-hub {
    display: none;
  }

  @media (min-width: 900px) {
    .seed-hub {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      align-self: stretch;
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--bg-2);
      /* One scrollport for the whole column; tail-follow targets this node. */
      overflow: auto;
    }
  }

  .seed-hub-label {
    flex-shrink: 0;
    margin: 0;
    padding: 0.6rem 1rem 0.4rem;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-3, var(--text-2));
    border-bottom: 1px solid var(--border);
  }

  :global(.seed-hub .your-wiki-detail) {
    border-radius: 0;
  }

  /* Mobile status strip: single row at bottom, desktop hidden */
  .seed-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.875rem;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    flex-shrink: 0;
    min-width: 0;
    overflow: hidden;
  }

  @media (min-width: 900px) {
    .seed-bar {
      display: none;
    }
  }

  .seed-bar-pulse {
    width: 6px;
    height: 6px;
    border-radius: 50%;
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

  .seed-bar-text {
    font-size: 0.8125rem;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .seed-bar-count {
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-3, var(--text-2));
    flex-shrink: 0;
    white-space: nowrap;
  }
</style>
