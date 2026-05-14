<script lang="ts">
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { TunnelTimelinePendingReviewApi } from '@shared/tunnelTimeline.js'
  import { B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT } from '@shared/b2bTunnelDelivery.js'
  import {
    BRAIN_QUERY_POLICY_TEMPLATES,
    type BrainQueryBuiltInPolicyId,
  } from '@client/lib/brainQueryPolicyTemplates.js'
  import TipTapMarkdownEditor from '@components/TipTapMarkdownEditor.svelte'
  import { CircleX, Send } from 'lucide-svelte'

  let {
    row,
    onMutate,
  }: {
    row: TunnelTimelinePendingReviewApi
    onMutate: () => void | Promise<void>
  } = $props()

  /** Mirrors TipTap markdown for Send enablement (sync on edit + when row draft loads). */
  let draftMarkdownLive = $state('')
  let markdownSyncEpoch = $state(0)
  let draftEditor = $state<TipTapMarkdownEditor | undefined>()
  let busy = $state(false)
  let actionError = $state<string | null>(null)
  let selectedTemplateId = $state<BrainQueryBuiltInPolicyId>('general')

  const isColdInbound = $derived(Boolean(row.isColdQuery && !row.grantId))
  const peerLabel = $derived.by(() => {
    const h = (row.peerHandle ?? '').trim().replace(/^@/, '')
    if (h) return h
    const d = (row.peerDisplayName ?? '').trim()
    return d || 'someone'
  })

  const draftInitial = $derived(row.draftSnippet?.trim() ?? '')

  const isDraftingPlaceholder = $derived.by(() => {
    const d = row.draftSnippet?.trim() ?? ''
    if (!d) return false
    return d.toLowerCase() === B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT.toLowerCase()
  })

  const showHandshake = $derived(isColdInbound)
  const showDraftEditor = $derived(Boolean(row.grantId) && !isDraftingPlaceholder && row.expectsResponse !== false)

  /** One bump per inbound row/draft revision — avoids reactive ping-pong with TipTap/synced fields. */
  let lastDraftSyncKey = $state('')
  $effect.pre(() => {
    void row.sessionId
    void row.draftSnippet
    void row.grantId
    void row.expectsResponse
    selectedTemplateId = 'general'
  })
  $effect.pre(() => {
    const key = `${row.sessionId}\0${String(row.updatedAtMs)}\0${row.draftSnippet ?? ''}\0${row.grantId ?? ''}`
    if (key === lastDraftSyncKey) return
    lastDraftSyncKey = key
    draftMarkdownLive = row.draftSnippet?.trim() ?? ''
    markdownSyncEpoch++
  })

  function handleDraftMarkdownUpdate(md: string): void {
    draftMarkdownLive = md.trim()
  }

  async function postApprove() {
    if (busy) return
    busy = true
    actionError = null
    try {
      const editedAnswer = draftEditor?.serializeMarkdown().trim() ?? draftMarkdownLive.trim()
      const res = await apiFetch('/api/chat/b2b/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: row.sessionId, editedAnswer }),
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

  async function postEstablishGrant() {
    if (busy) return
    busy = true
    actionError = null
    try {
      const tpl = BRAIN_QUERY_POLICY_TEMPLATES.find((t) => t.id === selectedTemplateId)
      const privacyPolicy = tpl?.text ?? BRAIN_QUERY_POLICY_TEMPLATES[0]!.text
      const res = await apiFetch('/api/chat/b2b/establish-grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: row.sessionId, privacyPolicy }),
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
</script>

<div
  class="flex w-full flex-col items-end"
  data-testid="tunnel-pending-review-container"
>
  <div
    class="flex w-full max-w-[min(100%,36rem)] flex-col rounded-2xl border-2 border-accent/40 bg-accent/5 px-3 py-3 text-[0.8125rem] leading-snug shadow-sm"
    data-testid="tunnel-pending-review"
  >
  <div class="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide text-accent">
    {$t('chat.tunnels.pendingCardTitle')}
  </div>
  <p class="mt-1 shrink-0 whitespace-pre-wrap break-words text-foreground">{row.askerSnippet}</p>

  {#if showHandshake}
    <div class="mt-3 shrink-0 space-y-2">
      <p class="m-0 text-[0.8125rem] font-semibold text-foreground">
        {$t('chat.review.detail.policy.handshakeTitle', { handle: peerLabel })}
      </p>
      <p class="m-0 text-[0.75rem] leading-snug text-muted">
        {row.expectsResponse === false
          ? $t('chat.review.detail.policy.handshakeDescriptionFyi')
          : $t('chat.review.detail.policy.handshakeDescription')}
      </p>
      <fieldset class="m-0 mt-2 space-y-2 border-0 p-0">
        <legend class="sr-only">{$t('chat.tunnels.connection.policySelectLabel')}</legend>
        {#each BRAIN_QUERY_POLICY_TEMPLATES as tpl (tpl.id)}
          <label
            class="flex cursor-pointer gap-2 rounded-md border px-2 py-2 {!busy
              ? selectedTemplateId === tpl.id
                ? 'border-accent bg-accent/10'
                : 'border-border bg-surface-2 hover:bg-surface-3'
              : 'cursor-not-allowed opacity-50'}"
          >
            <input
              type="radio"
              name="tunnel-cold-policy-{row.sessionId}"
              class="mt-0.5 shrink-0"
              value={tpl.id}
              checked={selectedTemplateId === tpl.id}
              disabled={busy}
              onchange={() => (selectedTemplateId = tpl.id)}
            />
            <span class="min-w-0 flex-1">
              <span class="block text-[0.8125rem] font-semibold text-foreground">{tpl.label}</span>
              <span class="mt-0.5 block text-[0.6875rem] leading-snug text-muted">{tpl.hint}</span>
            </span>
          </label>
        {/each}
      </fieldset>
    </div>
  {:else}
    {#if row.grantId && isDraftingPlaceholder}
      <p class="m-0 mt-3 shrink-0 text-[0.75rem] text-muted" data-testid="tunnel-pending-drafting">
        {$t('chat.review.detail.policy.draftingInProgress')}
      </p>
    {:else if row.grantId && row.expectsResponse !== false}
      <div class="mt-2 shrink-0 text-[0.65rem] font-medium text-muted">
        {$t('chat.tunnels.pendingDraftLabel')}
      </div>
      <div
        class="tunnel-pending-editor-body mt-1 flex min-h-[min(4.75rem,20vh)] max-h-[min(26rem,52vh)] flex-col overflow-hidden"
        aria-label={$t('chat.tunnels.pendingDraftLabel')}
      >
        <TipTapMarkdownEditor
          bind:this={draftEditor}
          initialMarkdown={draftInitial}
          markdownSyncEpoch={markdownSyncEpoch}
          disabled={busy}
          autoPersist={false}
          compact={true}
          onMarkdownUpdate={handleDraftMarkdownUpdate}
        />
      </div>
    {:else if row.grantId}
      <p class="m-0 mt-3 shrink-0 text-[0.75rem] leading-snug text-muted">
        {$t('chat.tunnels.pendingFyiNoDraft')}
      </p>
    {/if}
  {/if}

  {#if actionError}
    <p class="m-0 mt-2 shrink-0 text-danger text-[0.75rem]" role="alert">{actionError}</p>
  {/if}

  {#if showHandshake}
    <div class="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[0.75rem] font-semibold disabled:opacity-50"
        disabled={busy}
        onclick={() => void dismiss()}
      >
        <CircleX size={14} strokeWidth={2} aria-hidden="true" />
        {$t('chat.review.detail.policy.ignoreUser')}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[0.75rem] font-semibold text-white disabled:opacity-50"
        disabled={busy}
        data-testid="tunnel-pending-accept-draft"
        onclick={() => void postEstablishGrant()}
      >
        <Send size={14} strokeWidth={2} aria-hidden="true" />
        {row.expectsResponse === false
          ? $t('chat.review.detail.policy.connectTunnel')
          : $t('chat.review.detail.policy.acceptAndDraft')}
      </button>
    </div>
  {:else if !isDraftingPlaceholder}
    <div class="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[0.75rem] font-semibold disabled:opacity-50"
        disabled={busy}
        onclick={() => void dismiss()}
      >
        <CircleX size={14} strokeWidth={2} aria-hidden="true" />
        {$t('chat.review.detail.actions.dismiss')}
      </button>
      {#if showDraftEditor}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-[0.75rem] font-semibold text-white disabled:opacity-50"
          disabled={busy || !draftMarkdownLive.trim()}
          onclick={() => void postApprove()}
        >
          <Send size={14} strokeWidth={2} aria-hidden="true" />
          {$t('chat.review.detail.actions.send')}
        </button>
      {/if}
    </div>
  {/if}

  {#if row.policy && row.grantId}
    <p class="m-0 mt-2 shrink-0 text-[0.65rem] text-muted">
      {$t('chat.review.detail.policy.peerAt', { handle: peerLabel })}
    </p>
  {/if}
</div>
</div>

<style>
  /*
   * TipTap compact mode sets flex-none on root + scroll; without overrides the card must either
   * reserve a guessed height (leaving gaps) or the scroll region never absorbs a max-height cap.
   * !important beats TipTap utilities so tall drafts scroll inside the editor, short drafts snug-fit.
   */
  .tunnel-pending-editor-body :global(.tiptap-md-root-compact) {
    display: flex;
    flex: 1 1 0% !important;
    flex-direction: column;
    min-height: 0;
    max-height: 100%;
    overflow: hidden;
  }

  .tunnel-pending-editor-body :global(.tiptap-md-root-compact .tiptap-md-scroll) {
    flex: 1 1 0% !important;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto !important;
  }
</style>
