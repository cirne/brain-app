<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { cn } from '@client/lib/cn.js'
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { subscribeTunnelActivity } from '@client/lib/hubEvents/hubEventsClient.js'
  import { t } from '@client/lib/i18n/index.js'
  import { consumeTunnelOutboundSendStream } from '@client/lib/consumeTunnelOutboundSendStream.js'
  import {
    classifyGrantPolicy,
    normalizePolicyText,
    type GrantPolicyClassifySource,
  } from '@client/lib/brainAccessPolicyGrouping.js'
  import {
    fetchBrainAccessCustomPoliciesFromServer,
    mergeServerAndLegacyCustomPolicies,
    type BrainAccessCustomPolicy,
  } from '@client/lib/brainAccessCustomPolicies.js'
  import {
    buildBrainQueryGrantPolicyTemplates,
    templateById,
  } from '@client/lib/brainQueryPolicyTemplates.js'
  import { fetchBrainQueryBuiltinPolicyBodies } from '@client/lib/brainQueryBuiltinPolicyBodiesApi.js'
  import type { BrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'
  import TunnelMessage from '@components/TunnelMessage.svelte'
  import TunnelPendingMessage from '@components/TunnelPendingMessage.svelte'
  import UnifiedChatComposer from '@components/UnifiedChatComposer.svelte'
  import SegmentedControl from '@components/SegmentedControl.svelte'
  import BottomSheet from '@components/shell/BottomSheet.svelte'
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import type { TunnelTimelineEntryApi } from '@shared/tunnelTimeline.js'
  import type { SegmentedOption } from '@client/lib/segmentedControl.js'
  import { SlidersHorizontal, Settings } from 'lucide-svelte'

  let {
    tunnelHandle,
    inboundGrantIdInitial = null as string | null,
    outboundGrantIdInitial = null as string | null,
    peerDisplayNameInitial = '',
  }: {
    tunnelHandle: string
    inboundGrantIdInitial?: string | null
    outboundGrantIdInitial?: string | null
    peerDisplayNameInitial?: string
  } = $props()

  let loadError = $state<string | null>(null)
  let timeline = $state<TunnelTimelineEntryApi[]>([])
  let peerDisplayName = $state('')
  let inboundGrantId = $state<string | null>(null)
  let outboundGrantId = $state<string | null>(null)
  /** From tunnel-timeline API; enables cold-query send when peer has not granted outbound access yet. */
  let peerUserId = $state('')
  let policyDraft = $state<'auto' | 'review' | 'ignore'>('review')
  /** Matches SegmentedControl: Review each / Autosend; `undefined` when server policy is ignore. */
  let replyUiBind = $state<'review' | 'auto' | undefined>('review')
  let policyBusy = $state(false)
  let inboundPrivacyPolicy = $state('')
  let inboundPresetPolicyKey = $state<string | null>(null)
  let inboundCustomPolicyId = $state<string | null>(null)
  let tunnelCustomPolicies = $state<BrainAccessCustomPolicy[]>([])
  let tunnelBuiltinBodies = $state<Record<BrainQueryBuiltinPolicyId, string> | null>(null)
  /** Built-in preset id when text matches template; '' when custom / other policy. */
  let accessSelect = $state<'' | BrainQueryBuiltinPolicyId>('')
  let accessBusy = $state(false)
  let connectionSheetOpen = $state(false)
  let autoSendConfirmOpen = $state(false)

  let sending = $state(false)
  let tunnelComposerRef = $state<ReturnType<typeof UnifiedChatComposer> | undefined>(undefined)
  let sendError = $state<string | null>(null)
  let pendingOutbound = $state<{
    userText: string
    assistantText: string
    atMs: number
    awaitingPeerReview: boolean
    dismissed?: boolean
    /** When true, only the outbound user bubble is shown (FYI / no reply expected from peer brain). */
    omitAssistantRow?: boolean
  } | null>(null)

  let logEl = $state<HTMLDivElement | undefined>()

  const tunnelGrantTemplates = $derived(
    tunnelBuiltinBodies ? buildBrainQueryGrantPolicyTemplates(tunnelBuiltinBodies) : [],
  )

  const accessClassified = $derived.by(() => {
    if (!tunnelBuiltinBodies) return null
    const raw = inboundPrivacyPolicy.trim()
    if (!raw && !inboundPresetPolicyKey && !inboundCustomPolicyId) return null
    const grantLike: GrantPolicyClassifySource = {
      privacyPolicy: inboundPrivacyPolicy,
      presetPolicyKey: inboundPresetPolicyKey,
      customPolicyId: inboundCustomPolicyId,
    }
    return classifyGrantPolicy(grantLike, tunnelCustomPolicies, tunnelBuiltinBodies)
  })

  const accessHintText = $derived.by(() => {
    const c = accessClassified
    if (!c) return ''
    if (c.hint) return c.hint
    if (c.kind === 'custom') return c.label
    return $t('chat.tunnels.connection.accessHintOther')
  })

  const showCustomizeLink = $derived.by(() => {
    const c = accessClassified
    return c != null && (c.kind === 'adhoc' || c.kind === 'custom')
  })

  /** Review each / Autosend only (Ignore not exposed in toolbar). */
  const replySegmentOptions = $derived.by(
    (): SegmentedOption<'review' | 'auto'>[] => [
      {
        value: 'review',
        label: $t('chat.review.detail.policy.segment.review'),
        testId: 'tunnel-detail-reply-review',
      },
      {
        value: 'auto',
        label: $t('chat.review.detail.policy.segment.auto'),
        testId: 'tunnel-detail-reply-auto',
      },
    ],
  )

  const replyHintText = $derived.by(() => {
    if (policyDraft === 'ignore') return $t('chat.tunnels.connection.replyHint.ignoreActiveHeader')
    if (replyUiBind === 'auto') return $t('chat.tunnels.connection.replyHint.auto')
    return $t('chat.tunnels.connection.replyHint.review')
  })

  const connectionDisabled = $derived(policyBusy || accessBusy)
  const peerAtHandle = $derived(`@${tunnelHandle.trim()}`)

  function authorKindFor(actor: 'you' | 'your_brain' | 'them' | 'their_brain'): 'human' | 'assistant' {
    return actor === 'you' || actor === 'them' ? 'human' : 'assistant'
  }

  function actorLabelFor(actor: 'you' | 'your_brain' | 'them' | 'their_brain', peerFirstName: string): string {
    if (actor === 'your_brain') return $t('chat.tunnels.actorYourBrain')
    if (actor === 'you') return $t('chat.messageRow.you')
    if (actor === 'their_brain') {
      const firstTok = peerFirstName.trim().split(/\s+/)[0] ?? peerFirstName.trim()
      const n = peerFirstName.trim()
        ? firstTok || peerFirstName.trim()
        : (peerDisplayName.trim().split(/\s+/)[0] ?? peerDisplayName.trim()).trim() || '?'
      return $t('chat.tunnels.actorTheirBrain', { name: n })
    }
    return peerFirstName.trim() ? peerFirstName.trim() : $t('chat.messageRow.inboundRequesterFallback')
  }

  function hintFor(kind: TunnelTimelineEntryApi): string | undefined {
    if (kind.kind !== 'message') return undefined
    if (kind.hint === 'auto_sent') return $t('chat.tunnels.hintAutoSent')
    if (kind.hint === 'to_their_brain') return $t('chat.tunnels.hintToTheirBrain')
    return undefined
  }

  async function loadTimeline(): Promise<void> {
    loadError = null
    try {
      const h = tunnelHandle.trim()
      if (!h) return
      tunnelBuiltinBodies = await fetchBrainQueryBuiltinPolicyBodies()
      const res = await apiFetch(`/api/chat/b2b/tunnel-timeline/${encodeURIComponent(h)}`)
      if (!res.ok) {
        loadError = $t('chat.tunnels.detailLoadFailed')
        return
      }
      const j = (await res.json()) as {
        timeline?: unknown
        inboundPolicy?: unknown
        peerDisplayName?: unknown
        peerUserId?: unknown
        inboundGrantId?: unknown
        outboundGrantId?: unknown
        inboundPrivacyPolicy?: unknown
        inboundPresetPolicyKey?: unknown
        inboundCustomPolicyId?: unknown
      }
      peerUserId = typeof j.peerUserId === 'string' && j.peerUserId.trim() ? j.peerUserId.trim() : ''
      peerDisplayName =
        typeof j.peerDisplayName === 'string' && j.peerDisplayName.trim()
          ? j.peerDisplayName.trim()
          : peerDisplayNameInitial
      inboundGrantId =
        typeof j.inboundGrantId === 'string' && j.inboundGrantId.trim() ? j.inboundGrantId.trim() : null
      outboundGrantId =
        typeof j.outboundGrantId === 'string' && j.outboundGrantId.trim()
          ? j.outboundGrantId.trim()
          : outboundGrantIdInitial ?? null

      const fetchedCustom = await fetchBrainAccessCustomPoliciesFromServer()
      tunnelCustomPolicies = mergeServerAndLegacyCustomPolicies(fetchedCustom)

      inboundPrivacyPolicy =
        typeof j.inboundPrivacyPolicy === 'string' ? j.inboundPrivacyPolicy : ''
      const pk = j.inboundPresetPolicyKey
      inboundPresetPolicyKey = typeof pk === 'string' && pk.trim() ? pk.trim() : null
      const cid = j.inboundCustomPolicyId
      inboundCustomPolicyId = typeof cid === 'string' && cid.trim() ? cid.trim() : null
      {
        const grantLike: GrantPolicyClassifySource = {
          privacyPolicy: inboundPrivacyPolicy,
          presetPolicyKey: inboundPresetPolicyKey,
          customPolicyId: inboundCustomPolicyId,
        }
        const cls =
          tunnelBuiltinBodies &&
          (inboundPrivacyPolicy.trim() || inboundPresetPolicyKey || inboundCustomPolicyId)
            ? classifyGrantPolicy(grantLike, tunnelCustomPolicies, tunnelBuiltinBodies)
            : null
        accessSelect = cls?.kind === 'builtin' && cls.builtinId ? cls.builtinId : ''
      }

      const pol = j.inboundPolicy
      if (pol === 'auto' || pol === 'review' || pol === 'ignore') {
        policyDraft = pol
        replyUiBind = pol === 'ignore' ? undefined : pol
      }

      const list = Array.isArray(j.timeline) ? j.timeline : []
      timeline = list.filter(Boolean) as TunnelTimelineEntryApi[]
      await scrollLogBottom()
    } catch {
      loadError = $t('chat.tunnels.detailLoadFailed')
    }
  }

  async function scrollLogBottom() {
    await Promise.resolve()
    const el = logEl
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }

  async function patchInboundPolicy(p: 'auto' | 'review' | 'ignore'): Promise<void> {
    const gid = inboundGrantId?.trim() ?? ''
    if (!gid) return
    policyBusy = true
    try {
      const res = await apiFetch(`/api/chat/b2b/grants/${encodeURIComponent(gid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: p }),
      })
      if (res.ok) {
        policyDraft = p
        replyUiBind = p === 'ignore' ? undefined : p
        await loadTimeline()
      }
    } finally {
      policyBusy = false
    }
  }

  async function patchInboundPrivacyPreset(presetId: BrainQueryBuiltinPolicyId): Promise<void> {
    const bodies = tunnelBuiltinBodies
    const tmpl = bodies ? templateById(bodies, presetId) : undefined
    const gid = inboundGrantId?.trim() ?? ''
    if (!tmpl || !gid) return
    accessBusy = true
    try {
      const res = await apiFetch(`/api/brain-query/grants/${encodeURIComponent(gid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetPolicyKey: presetId }),
      })
      if (res.ok) await loadTimeline()
    } finally {
      accessBusy = false
    }
  }

  async function onAccessPresetChange(next: BrainQueryBuiltinPolicyId): Promise<void> {
    if (connectionDisabled) return
    const bodies = tunnelBuiltinBodies
    const tmpl = bodies ? templateById(bodies, next) : undefined
    if (tmpl && normalizePolicyText(inboundPrivacyPolicy) === normalizePolicyText(tmpl.text)) {
      return
    }
    await patchInboundPrivacyPreset(next)
  }

  function onPolicySelect(e: Event) {
    if (connectionDisabled) return
    const el = e.currentTarget as HTMLSelectElement
    const v = el.value as '' | BrainQueryBuiltinPolicyId
    accessSelect = v
    if (v === '') return
    void onAccessPresetChange(v)
  }

  async function onReplySegmentChange(next: 'review' | 'auto'): Promise<void> {
    if (connectionDisabled) return
    const effective = policyDraft

    if (next === effective) return

    if (next === 'auto') {
      autoSendConfirmOpen = true
      await tick()
      replyUiBind = effective === 'ignore' ? undefined : effective === 'auto' ? 'auto' : 'review'
      return
    }

    await patchInboundPolicy('review')
  }

  function confirmAutoSend() {
    autoSendConfirmOpen = false
    void patchInboundPolicy('auto')
  }

  async function sendOutboundMessage(message: string): Promise<void> {
    const gid = outboundGrantId?.trim() ?? ''
    const uid = peerUserId.trim()
    const text = message.trim()
    if (!text) return
    if (!gid && !uid) return
    sendError = null
    sending = true
    const atMs = Date.now()

    if (!gid) {
      pendingOutbound = { userText: text, assistantText: '', atMs, awaitingPeerReview: true }
      try {
        const res = await apiFetch('/api/chat/b2b/cold-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUserId: uid,
            message: text,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        })
        if (res.status === 409) {
          sendError = $t('chat.history.coldQuery.grantExists')
          tunnelComposerRef?.appendText(text)
          pendingOutbound = null
          return
        }
        if (res.status === 429) {
          sendError = $t('chat.history.coldQuery.rateLimited')
          tunnelComposerRef?.appendText(text)
          pendingOutbound = null
          return
        }
        if (!res.ok) {
          sendError = $t('chat.history.coldQuery.error')
          tunnelComposerRef?.appendText(text)
          pendingOutbound = null
          return
        }
        const j = (await res.json()) as { sessionId?: unknown }
        const sid = typeof j.sessionId === 'string' ? j.sessionId.trim() : ''
        if (!sid) {
          sendError = $t('chat.history.coldQuery.error')
          tunnelComposerRef?.appendText(text)
          pendingOutbound = null
          return
        }
        emit({ type: 'b2b:review-changed' })
        emit({ type: 'chat:sessions-changed' })
        await loadTimeline()
      } catch {
        sendError = $t('chat.history.coldQuery.error')
        tunnelComposerRef?.appendText(text)
      } finally {
        pendingOutbound = null
        sending = false
      }
      return
    }

    pendingOutbound = { userText: text, assistantText: '', atMs, awaitingPeerReview: false }
    try {
      const res = await apiFetch('/api/chat/b2b/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grantId: gid,
          message: text,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (!res.ok) {
        sendError = `${res.status}`
        tunnelComposerRef?.appendText(text)
        pendingOutbound = null
        return
      }
      const streamResult = await consumeTunnelOutboundSendStream(res, {
        onAssistantDelta: (full) => {
          pendingOutbound = {
            userText: text,
            assistantText: full,
            atMs,
            awaitingPeerReview: false,
          }
        },
      })
      if (pendingOutbound && streamResult.b2bAwaitingPeerReview) {
        pendingOutbound = {
          userText: text,
          assistantText: '',
          atMs,
          awaitingPeerReview: true,
        }
      }
      if (pendingOutbound && streamResult.b2bNoReplyExpected) {
        pendingOutbound = {
          userText: text,
          assistantText: '',
          atMs,
          awaitingPeerReview: false,
          omitAssistantRow: true,
        }
      }
      emit({ type: 'chat:sessions-changed' })
      await loadTimeline()
    } catch {
      sendError = 'network'
      tunnelComposerRef?.appendText(text)
    } finally {
      pendingOutbound = null
      sending = false
    }
  }

  $effect(() => {
    void tunnelHandle
    peerDisplayName = peerDisplayNameInitial
    inboundGrantId = inboundGrantIdInitial ?? null
    outboundGrantId = outboundGrantIdInitial ?? null
    peerUserId = ''
    void loadTimeline()
  })

  onMount(() => {
    const unsubApp = subscribe((ev) => {
      if (ev.type === 'b2b:review-changed' || ev.type === 'chat:sessions-changed') void loadTimeline()
    })
    const unsubTunnel = subscribeTunnelActivity((p) => {
      if (p == null) return
      if (p.scope === 'outbound' || p.scope === 'inbox') void loadTimeline()
    })
    return () => {
      unsubApp()
      unsubTunnel()
    }
  })

  $effect(() => {
    void timeline
    void scrollLogBottom()
  })
</script>

{#snippet policyDropdown(selTestId: string, className = '')}
  <select
    data-testid={selTestId}
    aria-label={$t('chat.tunnels.connection.policySelectAria')}
    class={cn(
      'box-border shrink-0 truncate rounded-lg border border-border bg-background px-2 py-1.5 text-[0.78rem] text-foreground outline-none disabled:opacity-50',
      className,
    )}
    disabled={connectionDisabled}
    value={accessSelect}
    title={accessHintText}
    onchange={onPolicySelect}
  >
    {#if accessSelect === ''}
      <option value="" disabled>{$t('chat.tunnels.connection.otherPolicyOption')}</option>
    {/if}
    {#each tunnelGrantTemplates as tmpl (tmpl.id)}
      <option value={tmpl.id}>{$t(tmpl.labelKey)}</option>
    {/each}
  </select>
{/snippet}

{#snippet replyReviewAutosendHeader()}
  <SegmentedControl
    class="w-[10.75rem] min-w-[9.5rem] shrink-0"
    options={replySegmentOptions}
    bind:value={replyUiBind}
    groupLabel={$t('chat.review.detail.policy.groupLabel')}
    disabled={connectionDisabled}
    readOnly={false}
    onValueChange={(next) => void onReplySegmentChange(next)}
  />
{/snippet}

{#snippet replyReviewAutosendSheet()}
  <SegmentedControl
    class="w-full shrink-0"
    options={replySegmentOptions}
    value={replyUiBind}
    groupLabel={$t('chat.review.detail.policy.groupLabel')}
    disabled={connectionDisabled}
    readOnly={true}
    onValueChange={(next) => void onReplySegmentChange(next)}
  />
{/snippet}

{#snippet headerCompactControls()}
  <div class="flex shrink-0 items-center gap-2" data-testid="tunnel-detail-header-controls">
    {#if showCustomizeLink}
      <a
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted transition-colors hover:bg-surface-3 hover:text-accent"
        href="/settings/brain-access"
        title={$t('chat.tunnels.connection.customizeBrainAccess')}
        aria-label={$t('chat.tunnels.connection.customizeBrainAccess')}
      >
        <Settings size={16} strokeWidth={2} />
      </a>
    {/if}
    {@render policyDropdown('tunnel-detail-policy-select', 'min-w-[11rem] max-w-[min(42vw,15rem)]')}
    {@render replyReviewAutosendHeader()}
  </div>
{/snippet}

{#snippet sheetConnectionBody()}
  <div class="flex flex-col gap-4 px-1" data-testid="tunnel-detail-connection-controls">
    <div class="min-w-0">
      <div class="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
        {$t('chat.tunnels.connection.accessHeading')}
      </div>
      <div class="flex flex-col gap-2">
        {@render policyDropdown('tunnel-detail-policy-select-sheet', 'w-full')}
        {#if showCustomizeLink}
          <a
            class="text-[0.7rem] font-medium text-accent underline-offset-2 hover:underline"
            href="/settings/brain-access"
          >
            {$t('chat.tunnels.connection.customizeBrainAccess')}
          </a>
        {/if}
      </div>
      {#if accessHintText}
        <p class="mt-1.5 m-0 text-[0.7rem] leading-snug text-muted">{accessHintText}</p>
      {/if}
    </div>

    <div class="min-w-0">
      <div class="mb-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted">
        {$t('chat.tunnels.connection.repliesHeading')}
      </div>
      <div class="min-w-0 overflow-x-auto">
        {@render replyReviewAutosendSheet()}
      </div>
      <p class="mt-1.5 m-0 text-[0.7rem] leading-snug text-muted">{replyHintText}</p>
    </div>
  </div>
{/snippet}

<div class="tunnel-detail flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
  <header
    class="shrink-0 border-b border-border px-3 py-2.5 md:px-4"
    data-testid="tunnel-detail-header"
  >
    <div
      class="flex min-h-10 min-w-0 flex-nowrap items-center gap-x-2 gap-y-1 overflow-x-auto md:gap-x-3"
    >
      <div class="min-w-0 flex-1 basis-[7.5rem] shrink">
        <h1 class="m-0 truncate text-sm font-semibold text-foreground md:text-base lg:text-lg">
          {peerDisplayName}
        </h1>
        <div class="truncate text-[0.7rem] leading-tight text-muted md:text-[0.75rem]">{peerAtHandle}</div>
      </div>

      {#if inboundGrantId}
        <div class="hidden shrink-0 items-center md:flex">
          {@render headerCompactControls()}
        </div>
        <button
          type="button"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-foreground md:hidden"
          data-testid="tunnel-detail-connection-mobile-trigger"
          aria-label={$t('chat.tunnels.connection.sheetTriggerAria')}
          onclick={() => (connectionSheetOpen = true)}
        >
          <SlidersHorizontal size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      {/if}
    </div>
  </header>

  {#if inboundGrantId}
    <BottomSheet
      open={connectionSheetOpen}
      title={$t('chat.tunnels.connection.sheetTitle', {
        name: peerDisplayName.trim() || peerAtHandle,
      })}
      titleId="tunnel-connection-sheet-title"
      onDismiss={() => (connectionSheetOpen = false)}
      panelClass="pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {#snippet children()}
        {@render sheetConnectionBody()}
      {/snippet}
    </BottomSheet>
  {/if}

  {#if loadError}
    <p class="m-0 shrink-0 px-3 py-2 text-danger text-sm" role="alert">{loadError}</p>
  {/if}

  <div
    bind:this={logEl}
    class="tunnel-detail-log min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4"
    data-testid="tunnel-detail-log"
  >
    {#if timeline.length === 0 && !loadError}
      <p class="text-muted text-sm">{$t('chat.tunnels.emptyTimeline')}</p>
    {/if}

    <div class="flex flex-col gap-4 pb-28">
      {#each timeline as item (item.kind === 'pending_review' ? item.id : `${item.kind}:${item.id}`)}
        {#if item.kind === 'pending_review'}
          <TunnelPendingMessage row={item} onMutate={() => loadTimeline()} />
        {:else}
        <TunnelMessage
          side={item.side}
          authorKind={authorKindFor(item.actor)}
          actorLabel={actorLabelFor(item.actor, peerDisplayName)}
          body={item.b2bAwaitingPeerReview 
            ? $t('chat.b2b.awaitingReceiptLabel') 
            : item.b2bDismissed 
              ? $t('chat.b2b.dismissedReceiptLabel') 
              : item.body}
          hint={hintFor(item)}
          atMs={item.atMs}
          class={item.b2bDismissed ? 'opacity-60 grayscale-[0.5]' : ''}
        />
        {/if}
      {/each}
      {#if pendingOutbound}
        <TunnelMessage
          side="yours"
          authorKind="human"
          actorLabel={$t('chat.messageRow.you')}
          body={pendingOutbound.userText}
          atMs={pendingOutbound.atMs}
        />
        {#if !pendingOutbound.omitAssistantRow}
        <TunnelMessage
          side="theirs"
          authorKind="assistant"
          actorLabel={actorLabelFor('their_brain', peerDisplayName)}
          body={pendingOutbound.awaitingPeerReview
            ? $t('chat.b2b.awaitingReceiptLabel')
            : pendingOutbound.dismissed
              ? $t('chat.b2b.dismissedReceiptLabel')
              : pendingOutbound.assistantText.trim()
                ? pendingOutbound.assistantText
                : '…'}
          atMs={pendingOutbound.atMs}
          class={pendingOutbound.dismissed ? 'opacity-60 grayscale-[0.5]' : ''}
        />
        {/if}
      {/if}
    </div>
  </div>

  <footer class="tunnel-detail-compose shrink-0 px-3 py-2 md:px-4">
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {#if sendError}
        <p class="m-0 text-danger text-[0.75rem]" role="alert">{sendError}</p>
      {/if}

      <p class="m-0 text-[0.7rem] leading-snug text-muted">{$t('chat.tunnels.composeFooterAssistOnly')}</p>

      <UnifiedChatComposer
        bind:this={tunnelComposerRef}
        voiceEligible={false}
        sessionResetKey={tunnelHandle.trim()}
        placeholder={$t('chat.tunnels.composePlaceholderAssistant')}
        wikiFiles={[]}
        skills={[]}
        streaming={false}
        inputDisabled={sending || (!outboundGrantId?.trim() && !peerUserId.trim())}
        autoFocusInputOnMount={false}
        onTranscribe={() => {}}
        onSend={(t) => void sendOutboundMessage(t)}
      />

      {#if !outboundGrantId?.trim() && peerUserId.trim()}
        <p class="m-0 text-[0.7rem] text-muted">{$t('chat.tunnels.outboundPreConnectHint')}</p>
      {:else if !outboundGrantId?.trim() && !peerUserId.trim()}
        <p class="m-0 text-[0.7rem] text-muted">{$t('chat.tunnels.outboundUnavailable')}</p>
      {/if}
    </div>
  </footer>
</div>

<ConfirmDialog
  open={autoSendConfirmOpen}
  title={$t('chat.tunnels.connection.autoSendTitle', { handle: peerAtHandle })}
  titleId="tunnel-auto-send-confirm-title"
  confirmLabel={$t('chat.review.detail.policy.autoSendConfirm.confirm')}
  onDismiss={() => (autoSendConfirmOpen = false)}
  onConfirm={confirmAutoSend}
>
  <p>{$t('chat.review.detail.policy.autoSendConfirm.body1')}</p>
  <p>{$t('chat.review.detail.policy.autoSendConfirm.body2')}</p>
</ConfirmDialog>

<style>
</style>
