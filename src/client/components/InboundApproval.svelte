<script lang="ts">
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { t } from '@client/lib/i18n/index.js'
  import { cn } from '@client/lib/cn.js'

  let {
    sessionId,
    initialAnswer = '',
    onDone,
  }: {
    sessionId: string
    initialAnswer?: string
    onDone?: () => void | Promise<void>
  } = $props()

  let editedAnswer = $derived(initialAnswer)
  let busy = $state(false)
  let error = $state<string | null>(null)

  async function finish(endpoint: '/api/chat/b2b/approve' | '/api/chat/b2b/decline') {
    if (busy) return
    busy = true
    error = null
    try {
      const body =
        endpoint.endsWith('/approve')
          ? { sessionId, editedAnswer }
          : { sessionId }
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        error = $t('chat.b2b.approval.failed')
        return
      }
      await onDone?.()
    } catch {
      error = $t('chat.b2b.approval.failed')
    } finally {
      busy = false
    }
  }
</script>

<section
  class="inbound-approval mx-auto box-border w-full max-w-chat px-[length:var(--chat-transcript-px)] pb-2 pt-2"
  aria-label={$t('chat.b2b.approval.title')}
>
  <div class="rounded-md border border-border bg-surface-2 p-3 shadow-sm">
    <div class="mb-2">
      <h2 class="m-0 text-sm font-semibold text-foreground">{$t('chat.b2b.approval.title')}</h2>
      <p class="m-0 mt-1 text-xs leading-snug text-muted">{$t('chat.b2b.approval.description')}</p>
    </div>

    <label class="mb-1 block text-xs font-semibold text-muted" for="inbound-approval-answer">
      {$t('chat.b2b.approval.answerLabel')}
    </label>
    <textarea
      id="inbound-approval-answer"
      class="min-h-24 w-full resize-y rounded-sm border border-border bg-surface px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent"
      bind:value={editedAnswer}
      disabled={busy}
    ></textarea>

    {#if error}
      <p class="m-0 mt-2 text-xs text-danger" role="alert">{error}</p>
    {/if}

    <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
      {#if busy}
        <span class="text-xs text-muted" role="status">{$t('chat.b2b.approval.saving')}</span>
      {/if}
      <button
        type="button"
        class="rounded-sm px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onclick={() => void finish('/api/chat/b2b/decline')}
      >
        {$t('chat.b2b.approval.decline')}
      </button>
      <button
        type="button"
        class={cn(
          'rounded-sm bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-opacity',
          'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
        )}
        disabled={busy}
        onclick={() => void finish('/api/chat/b2b/approve')}
      >
        {$t('chat.b2b.approval.approve')}
      </button>
    </div>
  </div>
</section>
