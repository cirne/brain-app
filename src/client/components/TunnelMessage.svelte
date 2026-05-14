<script lang="ts">
  import StreamingAgentMarkdown from '@components/agent-conversation/StreamingAgentMarkdown.svelte'

  let {
    side,
    authorKind = 'assistant' as 'human' | 'assistant',
    actorLabel,
    body,
    hint,
    atMs,
  }: {
    side: 'yours' | 'theirs'
    /** Human-authored (you/them) vs assistant reply bubbles — distinct chrome per OPP-113. */
    authorKind?: 'human' | 'assistant'
    actorLabel: string
    body: string
    hint?: string | undefined
    atMs: number
  } = $props()

  let rel = $state('')
  function relLabel(ms: number): string {
    const now = Date.now()
    const sec = Math.round((ms - now) / 1000)
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    const abs = Math.abs(sec)
    if (abs < 60) return rtf.format(Math.round(sec / 1), 'second')
    if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
    if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
    if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day')
    return rtf.format(Math.round(sec / (86400 * 30)), 'month')
  }

  $effect(() => {
    rel = relLabel(atMs)
  })

  const bubbleSurface = $derived(
    authorKind === 'human'
      ? side === 'yours'
        ? 'bg-surface-2 text-foreground ring-1 ring-border/70 border-s-[3px] border-s-accent'
        : 'bg-muted/20 text-foreground ring-1 ring-border/60 border-s-[3px] border-s-foreground/25'
      : side === 'yours'
        ? 'bg-accent/12 text-foreground ring-1 ring-border/60'
        : 'bg-surface-3 text-foreground ring-1 ring-border/60',
  )
</script>

<div
  class="flex w-full min-w-0 flex-col gap-0.5 {side === 'yours' ? 'items-end' : 'items-start'}"
  data-testid="tunnel-message"
>
  <div
    class="max-w-[min(100%,36rem)] rounded-2xl px-3 py-2 text-[0.8125rem] leading-snug shadow-sm {bubbleSurface}"
  >
    <div class="text-[0.65rem] font-medium uppercase tracking-wide text-muted">{actorLabel}</div>
    {#if authorKind === 'assistant'}
      <StreamingAgentMarkdown class="msg-content min-w-0" content={body} />
    {:else}
      <div class="whitespace-pre-wrap break-words">{body}</div>
    {/if}
    {#if hint}
      <div class="mt-1 text-[0.65rem] text-muted" data-testid="tunnel-message-hint">{hint}</div>
    {/if}
  </div>
  <span class="text-[0.65rem] text-muted/80">{rel}</span>
</div>
