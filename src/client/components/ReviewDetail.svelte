<script lang="ts">
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { ChatMessage } from '@client/lib/agentUtils.js'
  import type { B2BGrantPolicyApi, B2BReviewRowApi } from '@client/lib/b2bReviewTypes.js'
  import UnifiedChatComposer from '@components/UnifiedChatComposer.svelte'
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import { Archive, CircleX, MessagesSquare, Send } from 'lucide-svelte'

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
  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let actionError = $state<string | null>(null)
  /** Cold-query rows: policy to store on the new grant when you hit Send. */
  let coldEstablishPolicy = $state<B2BGrantPolicyApi>('review')
  let autoSendConfirmOpen = $state(false)

  const isColdInbound = $derived(Boolean(row.isColdQuery && !row.grantId))
  const canEditGrantPolicy = $derived(Boolean(row.grantId && row.policy != null))

  $effect(() => {
    void row.sessionId
    coldEstablishPolicy = 'review'
  })

  const peerLabel = $derived.by(() => {
    const h = (row.peerHandle ?? '').trim().replace(/^@/, '')
    if (h) return h
    const d = (row.peerDisplayName ?? '').trim()
    return d || 'someone'
  })

  const isPending = $derived(row.state === 'pending')

  const effectivePolicy = $derived<B2BGrantPolicyApi | null>(
    isColdInbound ? coldEstablishPolicy : row.policy,
  )

  const policySegClass = (p: B2BGrantPolicyApi) =>
    `rounded-md px-2 py-1 text-[0.6875rem] font-semibold transition-colors ${
      effectivePolicy === p
        ? 'bg-accent text-white'
        : 'bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground'
    }`

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
        endpoint.endsWith('/approve') && isColdInbound
          ? {
              sessionId: row.sessionId,
              editedAnswer: draftText.trim(),
              establishPolicy: coldEstablishPolicy,
            }
          : endpoint.endsWith('/approve')
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

  async function dismiss(): Promise<void> {
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

  async function applyGrantPolicyPatch(p: B2BGrantPolicyApi): Promise<void> {
    const gid = row.grantId?.trim() ?? ''
    if (!gid) return
    busy = true
    actionError = null
    try {
      const res = await apiFetch(`/api/chat/b2b/grants/${encodeURIComponent(gid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: p }),
      })
      if (!res.ok) {
        actionError = $t('chat.review.detail.actionFailed')
        return
      }
      emit({ type: 'b2b:review-changed' })
      await onMutate()
      await reloadSession()
    } catch {
      actionError = $t('chat.review.detail.actionFailed')
    } finally {
      busy = false
    }
  }

  async function handlePolicyPick(p: B2BGrantPolicyApi): Promise<void> {
    if (busy || !isPending) return
    if (isColdInbound) {
      if (p === 'ignore') {
        await dismiss()
        return
      }
      if (p === 'auto') {
        autoSendConfirmOpen = true
        return
      }
      coldEstablishPolicy = p
      return
    }
    if (!canEditGrantPolicy) return
    if (p === row.policy) return
    if (p === 'auto') {
      autoSendConfirmOpen = true
      return
    }
    await applyGrantPolicyPatch(p)
  }

  function dismissAutoSendConfirm(): void {
    autoSendConfirmOpen = false
  }

  function confirmAutoSend(): void {
    autoSendConfirmOpen = false
    if (isColdInbound) {
      coldEstablishPolicy = 'auto'
      return
    }
    void applyGrantPolicyPatch('auto')
  }

  async function regenerateFromComposer(notes: string): Promise<void> {
    if (busy || !isPending) return
    busy = true
    actionError = null
    try {
      const res = await apiFetch('/api/chat/b2b/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: row.sessionId, notes }),
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
</script>

<div
  class="review-detail flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-3 md:px-5 md:py-4"
  data-testid="review-detail"
>
  {#if loadError}
    <p class="m-0 shrink-0 pb-2 text-danger text-sm" role="alert">{loadError}</p>
  {/if}

  <div
    class="sender-strip mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-[color-mix(in_srgb,var(--bg-2)_55%,transparent)] px-2.5 py-2"
    data-testid="review-sender-strip"
  >
    <div class="flex min-w-0 flex-col gap-0.5">
      {#if isColdInbound}
        <span
          class="w-fit rounded bg-accent/15 px-1.5 py-[1px] text-[0.65rem] font-semibold uppercase tracking-wide text-accent"
        >
          {$t('chat.review.policy.coldBadge')}
        </span>
      {/if}
      <span class="truncate text-[0.8125rem] font-semibold text-foreground">
        {$t('chat.review.policy.peerAt', { handle: peerLabel })}
      </span>
    </div>
    {#if isPending && (isColdInbound || canEditGrantPolicy)}
      <div
        class="flex flex-wrap items-center gap-1"
        role="group"
        aria-label={$t('chat.review.policy.ariaGroup')}
      >
        {#each ['review', 'auto', 'ignore'] as p (p)}
          <button
            type="button"
            class={policySegClass(p as B2BGrantPolicyApi)}
            disabled={busy}
            data-testid={`review-policy-${p}`}
            onclick={() => void handlePolicyPick(p as B2BGrantPolicyApi)}
          >
            {$t(`chat.review.policy.segment.${p}`)}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--bg-2)_40%,transparent)] px-3 py-2">
    <p class="m-0 mb-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-muted">
      {$t('chat.review.detail.layers.from', { peer: peerLabel })}
    </p>
    <div class="text-[0.75rem] leading-snug text-muted">{askerText || '—'}</div>
  </div>

  <!-- Flex fill: reply body (no outer card chrome) -->
  <div class="mt-3 flex min-h-0 flex-1 flex-col gap-1 md:mt-4">
    <p class="m-0 shrink-0 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
      {$t('chat.review.detail.layers.reply')}
    </p>
    <div class="review-reply-body min-h-0 flex-1 overflow-hidden md:mt-1">
      {#if isPending}
        <textarea
          class="h-full min-h-[10rem] w-full resize-none bg-transparent px-0 py-1 text-[0.8125rem] leading-relaxed text-foreground placeholder:text-muted focus:outline-none"
          bind:value={draftText}
          disabled={busy}
          aria-label={$t('chat.review.detail.layers.reply')}
          data-testid="review-reply-textarea"
        ></textarea>
      {:else}
        <div
          class="h-full overflow-y-auto whitespace-pre-wrap py-1 text-[0.8125rem] leading-relaxed text-muted"
          data-testid="review-will-receive"
        >
          {draftText || '—'}
        </div>
      {/if}
    </div>
  </div>

  {#if isPending}
    <div class="review-regenerate-composer shrink-0 border-t border-border pt-3 md:mt-3 md:pt-3">
      <UnifiedChatComposer
        voiceEligible={false}
        sessionResetKey={row.sessionId}
        placeholder={$t('chat.review.detail.regenerate.placeholder')}
        wikiFiles={[]}
        skills={[]}
        streaming={false}
        inputDisabled={busy}
        autoFocusInputOnMount={false}
        onSend={(text) => void regenerateFromComposer(text)}
        onTranscribe={() => {}}
      />
    </div>
  {/if}

  {#if actionError}
    <p class="m-0 shrink-0 pb-2 text-danger text-sm pt-2" role="alert">{actionError}</p>
  {/if}

  <div class="review-detail-actions mt-auto flex shrink-0 flex-wrap items-center justify-end gap-2 pt-3">
    <button
      type="button"
      class="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-foreground"
      onclick={() => onOpenInboundThread(row.sessionId)}
    >
      <span class="hidden md:inline-flex md:items-center" aria-hidden="true">
        <MessagesSquare class="size-3.5 shrink-0" strokeWidth={2} />
      </span>
      {$t('chat.review.detail.actions.openThread')}
    </button>
    {#if isPending}
      <button
        type="button"
        class="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
        disabled={busy}
        onclick={() => void dismiss()}
      >
        <span class="hidden md:inline-flex md:items-center" aria-hidden="true">
          <Archive class="size-3.5 shrink-0" strokeWidth={2} />
        </span>
        {$t('chat.review.detail.actions.dismiss')}
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-3 disabled:opacity-50"
        disabled={busy}
        onclick={() => void postApproveOrDecline('/api/chat/b2b/decline')}
      >
        <span class="hidden md:inline-flex md:items-center" aria-hidden="true">
          <CircleX class="size-3.5 shrink-0" strokeWidth={2} />
        </span>
        {$t('chat.review.detail.actions.decline')}
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
        disabled={busy || !(draftText ?? '').trim()}
        onclick={() => void postApproveOrDecline('/api/chat/b2b/approve')}
      >
        <span class="hidden md:inline-flex md:items-center" aria-hidden="true">
          <Send class="size-3.5 shrink-0" strokeWidth={2} />
        </span>
        {$t('chat.review.detail.actions.send')}
      </button>
    {/if}
  </div>
</div>

<ConfirmDialog
  open={autoSendConfirmOpen}
  title={$t('chat.review.policy.autoSendConfirm.title', { handle: peerLabel })}
  titleId="review-auto-send-title"
  confirmLabel={$t('chat.review.policy.autoSendConfirm.confirm')}
  cancelLabel={$t('common.actions.cancel')}
  onDismiss={dismissAutoSendConfirm}
  onConfirm={confirmAutoSend}
>
  <p>{$t('chat.review.policy.autoSendConfirm.body1')}</p>
  <p>{$t('chat.review.policy.autoSendConfirm.body2')}</p>
</ConfirmDialog>

<style>
  /* Keep steering composer compact (avoid tall TipTap-sized chrome). */
  .review-regenerate-composer :global(textarea.chat-textarea) {
    max-height: 3.25rem;
    overflow-y: auto !important;
  }
</style>
