<script lang="ts">
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import { t } from '@client/lib/i18n/index.js'
  import { cn } from '@client/lib/cn.js'
  import type { ChatMessage } from '@client/lib/agentUtils.js'
  import type { B2BReviewRowApi } from '@client/lib/b2bReviewTypes.js'

  let {
    row,
    onOpenInboundThread,
    onMutate,
  }: {
    row: B2BReviewRowApi
    onOpenInboundThread: (_sessionId: string) => void
    onMutate: () => void | Promise<void>
  } = $props()

  let askerText = $state('')
  let draftText = $state('')
  let notesToAgent = $state('')
  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let actionError = $state<string | null>(null)

  const peerLabel = $derived.by(() => {
    const h = (row.peerHandle ?? '').trim().replace(/^@/, '')
    if (h) return h
    const d = (row.peerDisplayName ?? '').trim()
    return d || 'someone'
  })

  const isPending = $derived(row.state === 'pending')

  function textFromUserMessages(messages: ChatMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.role === 'user' && (m.content ?? '').trim()) return (m.content ?? '').trim()
    }
    return ''
  }

  function textFromLastAssistant(messages: ChatMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.role === 'assistant' && (m.content ?? '').trim()) return (m.content ?? '').trim()
    }
    return ''
  }

  async function reloadSession() {
    loadError = null
    try {
      const res = await apiFetch(`/api/chat/sessions/${encodeURIComponent(row.sessionId)}`)
      if (!res.ok) {
        loadError = $t('chat.review.detail.loadFailed')
        return
      }
      const doc = (await res.json()) as { messages?: ChatMessage[] }
      const msgs = Array.isArray(doc.messages) ? doc.messages : []
      askerText = textFromUserMessages(msgs) || row.askerSnippet
      draftText = textFromLastAssistant(msgs) || row.draftSnippet
    } catch {
      loadError = $t('chat.review.detail.loadFailed')
    }
  }

  $effect(() => {
    void reloadSession()
  })

  async function postApproveOrDecline(
    endpoint: '/api/chat/b2b/approve' | '/api/chat/b2b/decline',
  ): Promise<void> {
    if (busy) return
    busy = true
    actionError = null
    try {
      const body =
        endpoint.endsWith('/approve')
          ? { sessionId: row.sessionId, editedAnswer: draftText.trim() }
          : { sessionId: row.sessionId }
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        actionError = $t('chat.review.detail.actionFailed')
        return
      }
      emit({ type: 'b2b:review-changed' })
      await onMutate()
    } catch {
      actionError = $t('chat.review.detail.actionFailed')
    } finally {
      busy = false
    }
  }

  async function regenerate() {
    if (busy || !isPending) return
    busy = true
    actionError = null
    try {
      const res = await apiFetch('/api/chat/b2b/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: row.sessionId, notes: notesToAgent }),
      })
      if (!res.ok) {
        actionError = $t('chat.review.detail.regenerateFailed')
        return
      }
      const j = (await res.json()) as { draft?: unknown }
      const d = typeof j.draft === 'string' ? j.draft.trim() : ''
      if (d) draftText = d
      emit({ type: 'b2b:review-changed' })
      await onMutate()
    } catch {
      actionError = $t('chat.review.detail.regenerateFailed')
    } finally {
      busy = false
    }
  }

  const labelClass = 'm-0 mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted'
  const boxClass =
    'rounded-md border border-border bg-[color-mix(in_srgb,var(--bg-2)_40%,transparent)] p-3 text-[0.8125rem] leading-relaxed text-foreground'
</script>

<div
  class="review-detail flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 md:px-5"
  data-testid="review-detail"
>
  {#if loadError}
    <p class="m-0 text-danger text-sm" role="alert">{loadError}</p>
  {/if}

  <div class={boxClass}>
    <p class={labelClass}>{$t('chat.review.detail.layers.from', { peer: peerLabel })}</p>
    <div class="whitespace-pre-wrap text-foreground">{askerText || '—'}</div>
  </div>

  <div class={boxClass}>
    <p class={labelClass}>{$t('chat.review.detail.layers.draft')}</p>
    {#if isPending}
      <textarea
        class="min-h-[7.5rem] w-full resize-y rounded-sm border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        bind:value={draftText}
        disabled={busy}
        aria-label={$t('chat.review.detail.layers.draft')}
      ></textarea>
    {:else}
      <div class="whitespace-pre-wrap text-muted">{draftText || '—'}</div>
    {/if}
  </div>

  <div class={boxClass}>
    <p class={labelClass}>{$t('chat.review.detail.layers.willReceive')}</p>
    <div class="whitespace-pre-wrap text-foreground" data-testid="review-will-receive">
      {(draftText ?? '').trim() || '—'}
    </div>
  </div>

  {#if isPending}
    <div class={boxClass}>
      <p class={labelClass}>{$t('chat.review.detail.notesToAgent.label')}</p>
      <textarea
        class="min-h-[4rem] w-full resize-y rounded-sm border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        bind:value={notesToAgent}
        disabled={busy}
        placeholder={$t('chat.review.detail.notesToAgent.placeholder')}
      ></textarea>
      <div class="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold hover:bg-surface-3 disabled:opacity-50"
          disabled={busy}
          onclick={() => void regenerate()}
        >
          {$t('chat.review.detail.actions.regenerate')}
        </button>
      </div>
    </div>
  {/if}

  {#if actionError}
    <p class="m-0 text-danger text-sm" role="alert">{actionError}</p>
  {/if}

  <div class="flex flex-wrap items-center gap-2">
    {#if isPending}
      <button
        type="button"
        class={cn(
          'rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50',
        )}
        disabled={busy || !(draftText ?? '').trim()}
        onclick={() => void postApproveOrDecline('/api/chat/b2b/approve')}
      >
        {$t('chat.review.detail.actions.send')}
      </button>
      <button
        type="button"
        class="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-3 disabled:opacity-50"
        disabled={busy}
        onclick={() => void postApproveOrDecline('/api/chat/b2b/decline')}
      >
        {$t('chat.review.detail.actions.decline')}
      </button>
    {/if}
    <button
      type="button"
      class="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-foreground"
      onclick={() => onOpenInboundThread(row.sessionId)}
    >
      {$t('chat.review.detail.actions.openThread')}
    </button>
  </div>
</div>
