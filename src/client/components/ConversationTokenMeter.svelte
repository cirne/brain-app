<script lang="ts">
  import { CHAT_TOKEN_METER_REFERENCE } from '@client/lib/agentUtils.js'
  import { cn } from '@client/lib/cn.js'

  /** Show abbreviated token count beside the ring only above this usage (keeps header quiet). */
  const SHOW_COUNT_MIN_EXCLUSIVE = 100_000

  function formatTokenCountAbbrev(n: number): string {
    const x = Math.max(0, Math.floor(n))
    if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1)}M`
    if (x >= 1000) return `${(x / 1000).toFixed(1)}k`
    return x.toLocaleString()
  }

  /** Tooltip: token counts in thousands (K). */
  function formatTokensK(tokens: number): string {
    const k = Math.max(0, Math.floor(tokens)) / 1000
    return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`
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
    const ref = Math.max(0, Math.floor(referenceTokens))
    return `${formatTokensK(n)} / ${formatTokensK(ref)} Tokens (${pctRounded}%)`
  })

  const showCount = $derived(totalTokens > SHOW_COUNT_MIN_EXCLUSIVE)
  const abbrevCount = $derived(formatTokenCountAbbrev(totalTokens))

  const ringHigh = $derived(overRef || pctRounded >= 90)
</script>

<span
  class="token-meter me-[2px] inline-flex shrink-0 items-center justify-center gap-1 opacity-90"
  role="img"
  title={titleText}
  aria-label={titleText}
>
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" class="token-meter-svg block">
    <g transform="translate(10 10) rotate(-90)">
      <circle
        r={R}
        fill="none"
        class="token-meter-track stroke-[var(--bg-3,#2a2a2e)]"
        stroke-width="2.25"
        stroke-linecap="round"
      />
      <circle
        r={R}
        fill="none"
        class={cn(
          'token-meter-fill stroke-accent',
          ringHigh && 'token-meter-fill--high stroke-[var(--danger,#e05c5c)]',
        )}
        stroke-width="2.25"
        stroke-linecap="round"
        stroke-dasharray={`${dashMain} ${C}`}
      />
    </g>
  </svg>
  {#if showCount}
    <span
      class="token-meter-count whitespace-nowrap text-[10px] font-semibold leading-none tracking-[0.02em] text-muted"
      aria-hidden="true"
    >{abbrevCount}</span>
  {/if}
</span>
