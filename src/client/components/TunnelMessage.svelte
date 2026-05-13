<script lang="ts">
  let {
    side,
    actorLabel,
    body,
    hint,
    atMs,
    chatSessionId = null as string | null,
    onclickOpenChat,
  }: {
    side: 'yours' | 'theirs'
    actorLabel: string
    body: string
    hint?: string | undefined
    atMs: number
    chatSessionId?: string | null
    onclickOpenChat?: ((_sessionId: string) => void) | undefined
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
</script>

<div
  class="flex w-full min-w-0 flex-col gap-0.5 {side === 'yours' ? 'items-end' : 'items-start'}"
  data-testid="tunnel-message"
>
  <!-- Bubble is only interactive when wired tojump to an outbound tunnel chat -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="max-w-[min(100%,36rem)] rounded-2xl px-3 py-2 text-[0.8125rem] leading-snug shadow-sm ring-1 ring-border/60 {side ===
    'yours'
      ? 'bg-accent/12 text-foreground'
      : 'bg-surface-3 text-foreground'}"
    role={chatSessionId && onclickOpenChat ? 'button' : undefined}
    tabindex={chatSessionId && onclickOpenChat ? 0 : undefined}
    onclick={() => chatSessionId && onclickOpenChat?.(chatSessionId)}
    onkeydown={(e) => {
      if (!chatSessionId || !onclickOpenChat) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onclickOpenChat(chatSessionId)
      }
    }}
  >
    <div class="text-[0.65rem] font-medium uppercase tracking-wide text-muted">{actorLabel}</div>
    <div class="whitespace-pre-wrap break-words">{body}</div>
    {#if hint}
      <div class="mt-1 text-[0.65rem] text-muted" data-testid="tunnel-message-hint">{hint}</div>
    {/if}
  </div>
  {#if chatSessionId && onclickOpenChat}
    <span class="max-w-[min(100%,36rem)] text-[0.65rem] text-muted">Open full chat</span>
  {/if}
  <span class="text-[0.65rem] text-muted/80">{rel}</span>
</div>
