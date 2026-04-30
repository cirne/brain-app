<script lang="ts">
  import { CHAT_TOKEN_METER_REFERENCE } from '@client/lib/agentUtils.js'

  /** Show abbreviated token count beside the ring only above this usage (keeps header quiet). */
  const SHOW_COUNT_MIN_EXCLUSIVE = 100_000

  function formatTokenCountAbbrev(n: number): string {
    const x = Math.max(0, Math.floor(n))
    if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`
    if (x >= 1000) return `${(x / 1000).toFixed(1)}k`
    return x.toLocaleString()
  }

  let {
    totalTokens = 0,
    referenceTokens = CHAT_TOKEN_METER_REFERENCE,
  }: {
    totalTokens?: number
    referenceTokens?: number
  } = $props()

  const R = 7.5
  const C = 2 * Math.PI * R

  const ringFrac = $derived(
    referenceTokens > 0 ? Math.min(1, Math.max(0, totalTokens / referenceTokens)) : 0,
  )
  const dashMain = $derived(ringFrac * C)
  const pctRounded = $derived(
    referenceTokens > 0 ? Math.min(100, Math.round((totalTokens / referenceTokens) * 100)) : 0,
  )
  const overRef = $derived(referenceTokens > 0 && totalTokens > referenceTokens)

  const titleText = $derived.by(() => {
    const n = Math.max(0, Math.floor(totalTokens))
    const formatted = n.toLocaleString()
    return `Conversation usage: ${formatted} tokens (model-reported assistant turns), about ${pctRounded}% of ${(referenceTokens / 1000).toFixed(0)}k reference — not exact context window fill.`
  })

  const showCount = $derived(totalTokens > SHOW_COUNT_MIN_EXCLUSIVE)
  const abbrevCount = $derived(formatTokenCountAbbrev(totalTokens))
</script>

<span
  class="token-meter"
  role="img"
  title={titleText}
  aria-label={titleText}
>
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" class="token-meter-svg">
    <g transform="translate(10 10) rotate(-90)">
      <circle
        r={R}
        fill="none"
        class="token-meter-track"
        stroke-width="2.25"
        stroke-linecap="round"
      />
      <circle
        r={R}
        fill="none"
        class="token-meter-fill"
        class:token-meter-fill--high={overRef || pctRounded >= 90}
        stroke-width="2.25"
        stroke-linecap="round"
        stroke-dasharray={`${dashMain} ${C}`}
      />
    </g>
  </svg>
  {#if showCount}
    <span class="token-meter-count" aria-hidden="true">{abbrevCount}</span>
  {/if}
</span>

<style>
  .token-meter {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-shrink: 0;
    margin-inline-end: 2px;
    opacity: 0.92;
  }

  .token-meter-count {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-2);
    line-height: 1;
    white-space: nowrap;
  }

  .token-meter-svg {
    display: block;
  }

  .token-meter-track {
    stroke: var(--bg-3, #2a2a2e);
  }

  .token-meter-fill {
    stroke: var(--accent);
  }

  .token-meter-fill--high {
    stroke: var(--danger, #e05c5c);
  }
</style>
