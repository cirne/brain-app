<script lang="ts">
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { ChatMessage } from '@client/lib/agentUtils.js'
  import type { B2BGrantPolicyApi, B2BReviewRowApi } from '@client/lib/b2bReviewTypes.js'
  import { BRAIN_QUERY_GRANT_POLICY_TEMPLATE_META, type BrainQueryBuiltinPolicyId } from '@client/lib/brainQueryPolicyTemplates.js'
  import { B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT } from '@shared/b2bTunnelDelivery.js'
  import UnifiedChatComposer from '@components/UnifiedChatComposer.svelte'
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import TipTapMarkdownEditor from '@components/TipTapMarkdownEditor.svelte'
  import StreamingAgentMarkdown from '@components/agent-conversation/StreamingAgentMarkdown.svelte'
  import { subscribeTunnelActivity, type TunnelActivityPayload } from '@client/lib/hubEvents/hubEventsClient.js'
  import { Archive, Ban, CircleX, ClipboardCheck, MessagesSquare, Send, Zap } from '@lucide/svelte'

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
  /** Last assistant markdown from the server (reload / regenerate only — not updated while typing). */
  let draftText = $state('')
  /** Mirrors TipTap markdown for Send enablement (sync on edit + after server load). */
  let replyMarkdownLive = $state('')
  let markdownSyncEpoch = $state(0)
  let replyEditor = $state<TipTapMarkdownEditor | undefined>()
  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let actionError = $state<string | null>(null)
  let autoSendConfirmOpen = $state(false)
  let selectedTemplateId = $state<BrainQueryBuiltinPolicyId>('general')

  const isColdInbound = $derived(Boolean(row.isColdQuery && !row.grantId))
  const canEditGrantPolicy = $derived(Boolean(row.grantId && row.policy != null))

  $effect(() => {
    void row.sessionId
    selectedTemplateId = 'general'
  })

  const peerLabel = $derived.by(() => {
    const h = (row.peerHandle ?? '').trim().replace(/^@/, '')
    if (h) return h
    const d = (row.peerDisplayName ?? '').trim()
    return d || 'someone'
  })

  const isPending = $derived(row.state === 'pending')

  const isDraftingPlaceholder = $derived(
    draftText.trim().toLowerCase() === B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT.toLowerCase(),
  )

  const policySegBase =
    'relative min-w-0 flex-1 touch-manipulation items-center justify-center gap-1 border-0 px-2 py-1.5 text-center text-[0.6875rem] font-semibold transition-colors focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:opacity-50 sm:flex-none sm:px-2.5'
  const policySegClass = (p: B2BGrantPolicyApi) =>
    `inline-flex ${policySegBase} ${
      row.policy === p
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

  function tunnelInboxTouchesRow(payload: TunnelActivityPayload | null, r: B2BReviewRowApi): boolean {
    if (!payload || payload.scope !== 'inbox') return false
    const inId = typeof payload.inboundSessionId === 'string' ? payload.inboundSessionId.trim() : ''
    if (inId && inId === r.sessionId.trim()) return true
    const gid = typeof payload.grantId === 'string' ? payload.grantId.trim() : ''
    const rowGid = r.grantId?.trim() ?? ''
    return Boolean(gid && rowGid && gid === rowGid)
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
      replyMarkdownLive = draftText.trim()
      markdownSyncEpoch++
    } catch {
      loadError = $t('chat.review.detail.loadFailed')
    }
  }

  $effect(() => {
    void row.sessionId
    void row.updatedAtMs
    void row.draftSnippet
    void reloadSession()
  })

  $effect(() => {
    void row.sessionId
    void row.grantId
    return subscribeTunnelActivity((payload) => {
      if (!tunnelInboxTouchesRow(payload, row)) return
      void reloadSession()
    })
  })

  async function postApproveOrDecline(
    endpoint: '/api/chat/b2b/approve' | '/api/chat/b2b/decline',
  ): Promise<void> {
    if (busy) return
    busy = true
    actionError = null
    try {
      let body: Record<string, unknown>
      if (endpoint.endsWith('/approve')) {
        const editedAnswer = replyEditor?.serializeMarkdown().trim() ?? replyMarkdownLive.trim()
        body = { sessionId: row.sessionId, editedAnswer }
      } else {
        body = { sessionId: row.sessionId }
      }
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
    if (!canEditGrantPolicy) return
    if (p === row.policy) return
    if (p === 'auto') {
      autoSendConfirmOpen = true
      return
    }
    await applyGrantPolicyPatch(p)
  }

  async function postEstablishGrant(): Promise<void> {
    if (busy || !isPending) return
    busy = true
    actionError = null
    try {
      const res = await apiFetch('/api/chat/b2b/establish-grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: row.sessionId, presetPolicyKey: selectedTemplateId }),
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

  function dismissAutoSendConfirm(): void {
    autoSendConfirmOpen = false
  }

  function confirmAutoSend(): void {
    autoSendConfirmOpen = false
    void applyGrantPolicyPatch('auto')
  }

  async function regenerateFromComposer(notes: string): Promise<void> {
    if (busy || !isPending || isColdInbound || isDraftingPlaceholder) return
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
      if (d) {
        draftText = d
        replyMarkdownLive = d.trim()
        markdownSyncEpoch++
      }
      emit({ type: 'b2b:review-changed' })
      await onMutate()
    } catch {
      actionError = $t('chat.review.detail.regenerateFailed')
    } finally {
      busy = false
    }
  }

  function handleReplyMarkdownUpdate(md: string): void {
    replyMarkdownLive = md.trim()
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
          {$t('chat.review.detail.policy.coldBadge')}
        </span>
      {/if}
      <span class="truncate text-[0.8125rem] font-semibold text-foreground">
        {$t('chat.review.detail.policy.peerAt', { handle: peerLabel })}
      </span>
    </div>
    {#if isPending && canEditGrantPolicy}
      <div class="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:max-w-full sm:items-end">
        <span
          id="review-policy-segments-label"
          class="text-[0.6875rem] font-medium leading-snug text-muted sm:text-right"
        >
          {$t('chat.review.detail.policy.groupLabel')}
        </span>
        <div
          class="inline-flex w-full min-w-0 divide-x divide-border/80 overflow-hidden rounded-lg border border-border bg-surface-2 shadow-sm sm:w-auto"
          role="group"
          aria-labelledby="review-policy-segments-label"
        >
          {#each ['review', 'auto', 'ignore'] as p (p)}
            <button
              type="button"
              class={policySegClass(p as B2BGrantPolicyApi)}
              disabled={busy}
              data-testid={`review-policy-${p}`}
              aria-pressed={row.policy === p}
              onclick={() => void handlePolicyPick(p as B2BGrantPolicyApi)}
            >
              <span class="hidden shrink-0 md:inline-flex md:items-center" aria-hidden="true">
                {#if p === 'review'}
                  <ClipboardCheck class="size-3.5" strokeWidth={2.25} />
                {:else if p === 'auto'}
                  <Zap class="size-3.5" strokeWidth={2.25} />
                {:else}
                  <Ban class="size-3.5" strokeWidth={2.25} />
                {/if}
              </span>
              {$t(`chat.review.detail.policy.segment.${p}`)}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  {#if isPending && isColdInbound}
    <div
      class="mb-3 shrink-0 space-y-2 rounded-md border border-border/70 bg-[color-mix(in_srgb,var(--bg-2)_40%,transparent)] px-3 py-3"
      data-testid="review-cold-handshake"
    >
      <p class="m-0 text-[0.875rem] font-semibold text-foreground">
        {$t('chat.review.detail.policy.handshakeTitle', { handle: peerLabel })}
      </p>
      <p class="m-0 text-[0.8125rem] leading-snug text-muted">
        {$t('chat.review.detail.policy.handshakeDescription')}
      </p>
      <fieldset class="m-0 mt-2 space-y-2 border-0 p-0">
        <legend class="sr-only">{$t('chat.tunnels.connection.policySelectLabel')}</legend>
        {#each BRAIN_QUERY_GRANT_POLICY_TEMPLATE_META as tpl (tpl.id)}
          <label
            class="flex cursor-pointer gap-2 rounded-md border px-2 py-2 {!busy
              ? selectedTemplateId === tpl.id
                ? 'border-accent bg-accent/10'
                : 'border-border bg-surface-2 hover:bg-surface-3'
              : 'cursor-not-allowed opacity-50'}"
          >
            <input
              type="radio"
              name="review-cold-policy-{row.sessionId}"
              class="mt-0.5 shrink-0"
              value={tpl.id}
              checked={selectedTemplateId === tpl.id}
              disabled={busy}
              onchange={() => (selectedTemplateId = tpl.id)}
            />
            <span class="min-w-0 flex-1">
              <span class="block text-[0.8125rem] font-semibold text-foreground">{$t(tpl.labelKey)}</span>
              <span class="mt-0.5 block text-[0.6875rem] leading-snug text-muted">{$t(tpl.hintKey)}</span>
            </span>
          </label>
        {/each}
      </fieldset>
      <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          class="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          disabled={busy}
          onclick={() => void dismiss()}
        >
          <span class="hidden md:inline-flex md:items-center" aria-hidden="true">
            <Ban class="size-3.5 shrink-0" strokeWidth={2} />
          </span>
          {$t('chat.review.detail.policy.ignoreUser')}
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          disabled={busy}
          data-testid="review-accept-establish"
          onclick={() => void postEstablishGrant()}
        >
          <span class="hidden md:inline-flex md:items-center" aria-hidden="true">
            <Send class="size-3.5 shrink-0" strokeWidth={2} />
          </span>
          {$t('chat.review.detail.policy.acceptAndDraft')}
        </button>
      </div>
    </div>
  {/if}

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
    <div
      class="review-reply-body flex min-h-0 flex-1 flex-col overflow-hidden md:mt-1"
      aria-label={$t('chat.review.detail.layers.reply')}
    >
      {#if isPending}
        {#if isColdInbound}
          <p class="m-0 shrink-0 py-2 text-[0.8125rem] leading-snug text-muted">
            {$t('chat.review.detail.policy.replyPendingPolicy')}
          </p>
        {:else if isDraftingPlaceholder}
          <p class="m-0 shrink-0 py-2 text-[0.8125rem] text-muted" data-testid="review-drafting">
            {$t('chat.review.detail.policy.draftingInProgress')}
          </p>
        {:else}
          <TipTapMarkdownEditor
            bind:this={replyEditor}
            initialMarkdown={draftText}
            markdownSyncEpoch={markdownSyncEpoch}
            disabled={busy}
            autoPersist={false}
            compact={true}
            onMarkdownUpdate={handleReplyMarkdownUpdate}
          />
        {/if}
      {:else}
        <div
          class="review-will-receive h-full min-h-0 flex-1 overflow-y-auto py-1 text-[0.8125rem] leading-relaxed text-muted"
          data-testid="review-will-receive"
        >
          {#if draftText.trim()}
            <StreamingAgentMarkdown
              content={draftText}
              class="text-[0.8125rem] leading-relaxed text-muted"
            />
          {:else}
            —
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if isPending && !isColdInbound && !isDraftingPlaceholder}
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
    {#if isPending && !isColdInbound}
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
        disabled={busy || !replyMarkdownLive.trim() || isDraftingPlaceholder}
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
  title={$t('chat.review.detail.policy.autoSendConfirm.title', { handle: peerLabel })}
  titleId="review-auto-send-title"
  confirmLabel={$t('chat.review.detail.policy.autoSendConfirm.confirm')}
  cancelLabel={$t('common.actions.cancel')}
  onDismiss={dismissAutoSendConfirm}
  onConfirm={confirmAutoSend}
>
  <p>{$t('chat.review.detail.policy.autoSendConfirm.body1')}</p>
  <p>{$t('chat.review.detail.policy.autoSendConfirm.body2')}</p>
</ConfirmDialog>

<style>
  /* Keep steering composer compact (avoid tall TipTap-sized chrome). */
  .review-regenerate-composer :global(textarea.chat-textarea) {
    max-height: 3.25rem;
    overflow-y: auto !important;
  }

  /* Tunnel reply editor: give compact TipTap a usable minimum height in the review pane. */
  .review-reply-body :global(.tiptap-md-root-compact) {
    min-height: 10rem;
  }
</style>
