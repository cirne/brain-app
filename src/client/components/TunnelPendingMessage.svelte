<script lang="ts">
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { B2BGrantPolicyApi } from '@client/lib/b2bReviewTypes.js'
  import type { TunnelTimelinePendingReviewApi } from '@shared/tunnelTimeline.js'
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import { CircleX, Send } from 'lucide-svelte'

  let {
    row,
    onMutate,
  }: {
    row: TunnelTimelinePendingReviewApi
    onMutate: () => void | Promise<void>
  } = $props()

  let edited = $state('')
  let busy = $state(false)
  let actionError = $state<string | null>(null)
  let coldEstablishPolicy = $state<B2BGrantPolicyApi>('review')
  let autoSendConfirmOpen = $state(false)

  const isColdInbound = $derived(Boolean(row.isColdQuery && !row.grantId))
  const peerLabel = $derived.by(() => {
    const h = (row.peerHandle ?? '').trim().replace(/^@/, '')
    if (h) return h
    const d = (row.peerDisplayName ?? '').trim()
    return d || 'someone'
  })

  $effect(() => {
    void row.sessionId
    void row.draftSnippet
    edited = row.draftSnippet?.trim() ?? ''
    coldEstablishPolicy = 'review'
  })

  async function postApprove() {
    if (busy) return
    busy = true
    actionError = null
    try {
      const body =
        isColdInbound
          ? {
              sessionId: row.sessionId,
              editedAnswer: edited.trim(),
              establishPolicy: coldEstablishPolicy,
            }
          : { sessionId: row.sessionId, editedAnswer: edited.trim() }
      const res = await apiFetch('/api/chat/b2b/approve', {
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

  async function dismiss() {
    if (busy) return
    busy = true
    actionError = null
    try {
      const res = await apiFetch('/api/chat/b2b/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: row.sessionId }),
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

  function handlePolicyPick(p: B2BGrantPolicyApi) {
    if (busy) return
    if (isColdInbound) {
      if (p === 'ignore') {
        void dismiss()
        return
      }
      if (p === 'auto') {
        autoSendConfirmOpen = true
        return
      }
      coldEstablishPolicy = p
    }
  }

  function confirmAutoCold() {
    autoSendConfirmOpen = false
    coldEstablishPolicy = 'auto'
  }
</script>

<div
  class="w-full max-w-[min(100%,36rem)] rounded-2xl border-2 border-accent/40 bg-accent/5 px-3 py-3 text-[0.8125rem] leading-snug shadow-sm"
  data-testid="tunnel-pending-review"
>
  <div class="text-[0.65rem] font-semibold uppercase tracking-wide text-accent">
    {$t('chat.tunnels.pendingCardTitle')}
  </div>
  <p class="mt-1 whitespace-pre-wrap break-words text-foreground">{row.askerSnippet}</p>
  <div class="mt-2 text-[0.65rem] font-medium text-muted">{$t('chat.tunnels.pendingDraftLabel')}</div>
  <textarea
    class="mt-1 box-border min-h-[4.5rem] w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[0.8125rem] text-foreground"
    bind:value={edited}
    disabled={busy}
  ></textarea>

  {#if isColdInbound}
    <div class="mt-3 flex flex-wrap gap-1.5">
      <span class="w-full text-[0.65rem] font-medium text-muted">{$t('chat.review.detail.policy.groupLabel')}</span>
      {#each ['review', 'auto', 'ignore'] as p (p)}
        <button
          type="button"
          disabled={busy}
          class="rounded-md border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide {!busy
            ? coldEstablishPolicy === p
              ? 'border-accent bg-accent text-white'
              : 'border-border bg-surface-2 text-muted hover:bg-surface-3'
            : 'opacity-50'}"
          onclick={() => handlePolicyPick(p as B2BGrantPolicyApi)}
        >
          {p}
        </button>
      {/each}
    </div>
  {/if}

  {#if actionError}
    <p class="m-0 mt-2 text-danger text-[0.75rem]" role="alert">{actionError}</p>
  {/if}

  <div class="mt-3 flex flex-wrap gap-2">
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[0.75rem] font-semibold text-white disabled:opacity-50"
      disabled={busy || !edited.trim()}
      onclick={() => void postApprove()}
    >
      <Send size={14} strokeWidth={2} aria-hidden="true" />
      {$t('chat.review.detail.actions.send')}
    </button>
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[0.75rem] font-semibold disabled:opacity-50"
      disabled={busy}
      onclick={() => void dismiss()}
    >
      <CircleX size={14} strokeWidth={2} aria-hidden="true" />
      {$t('chat.review.detail.actions.dismiss')}
    </button>
  </div>

  {#if row.policy && row.grantId}
    <p class="m-0 mt-2 text-[0.65rem] text-muted">
      {$t('chat.review.detail.policy.peerAt', { handle: peerLabel })}
    </p>
  {/if}
</div>

<ConfirmDialog
  open={autoSendConfirmOpen}
  title={$t('chat.review.detail.policy.autoSendConfirm.title', { handle: peerLabel })}
  titleId="tunnel-auto-send-title"
  confirmLabel={$t('chat.review.detail.policy.autoSendConfirm.confirm')}
  cancelLabel={$t('common.actions.cancel')}
  onDismiss={() => (autoSendConfirmOpen = false)}
  onConfirm={() => confirmAutoCold()}
>
  <p>{$t('chat.review.detail.policy.autoSendConfirm.body1')}</p>
  <p>{$t('chat.review.detail.policy.autoSendConfirm.body2')}</p>
</ConfirmDialog>
