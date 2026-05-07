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

  const ringFrac = $derived(
    referenceTokens > 0 ? Math.min(1, Math.max(0, totalTokens / referenceTokens)) : 0,
  )
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
  <span
    class={cn(
      'token-meter-ring block h-5 w-5 shrink-0 rounded-full',
      ringHigh && 'token-meter-ring--high',
    )}
    style="--ring-frac: {ringFrac};"
    aria-hidden="true"
  ></span>
  {#if showCount}
    <span
      class="token-meter-count whitespace-nowrap text-[10px] font-semibold leading-none tracking-[0.02em] text-muted"
      aria-hidden="true"
    >{abbrevCount}</span>
  {/if}
</span>

<style>
  .token-meter-ring {
    background: conic-gradient(
      from -90deg,
      var(--token-meter-fill, var(--accent)) calc(var(--ring-frac, 0) * 360deg),
      var(--bg-3, #2a2a2e) 0
    );
    -webkit-mask: radial-gradient(
      farthest-side,
      transparent 63.5%,
      #000 63.75%,
      #000 86%,
      transparent 86.25%
    );
    mask: radial-gradient(
      farthest-side,
      transparent 63.5%,
      #000 63.75%,
      #000 86%,
      transparent 86.25%
    );
  }

  .token-meter-ring--high {
    --token-meter-fill: var(--danger, #e05c5c);
  }
</style>
