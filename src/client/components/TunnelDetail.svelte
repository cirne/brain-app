<script lang="ts">
  import { onMount } from 'svelte'
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { subscribeTunnelActivity } from '@client/lib/hubEvents/hubEventsClient.js'
  import { t } from '@client/lib/i18n/index.js'
  import TunnelMessage from '@components/TunnelMessage.svelte'
  import TunnelPendingMessage from '@components/TunnelPendingMessage.svelte'
  import type { TunnelTimelineEntryApi } from '@shared/tunnelTimeline.js'

  let {
    tunnelHandle,
    onOpenOutboundChat,
    inboundGrantIdInitial = null as string | null,
    outboundGrantIdInitial = null as string | null,
    peerDisplayNameInitial = '',
  }: {
    tunnelHandle: string
    /** Jump to outbound B2B chat session from the unified log. */
    onOpenOutboundChat: (_sessionId: string, _chatTitleHint?: string) => void
    inboundGrantIdInitial?: string | null
    outboundGrantIdInitial?: string | null
    peerDisplayNameInitial?: string
  } = $props()

  let loadError = $state<string | null>(null)
  let timeline = $state<TunnelTimelineEntryApi[]>([])
  let peerDisplayName = $state('')
  /** Owner-side inbound grant (PATCH policy/auto-respond). */
  let inboundGrantId = $state<string | null>(null)
  /** Asker outbound grant (`POST …/send`). */
  let outboundGrantId = $state<string | null>(null)
  let policyDraft = $state<'auto' | 'review' | 'ignore'>('review')
  let policyBusy = $state(false)

  /** Compose recipient: query their assistant vs DM human (stub). */
  let recipient = $state<'brain' | 'human'>('brain')
  let composeBody = $state('')
  let sending = $state(false)
  let sendError = $state<string | null>(null)
  let humanNotice = $state(false)

  let logEl = $state<HTMLDivElement | undefined>()

  function possessiveBrainLabel(nameRaw: string): string {
    const n = nameRaw.trim()
    const base = (n.split(/\s+/)[0] ?? n).trim() || '?'
    if (base.endsWith('s') || base.endsWith('S')) return `${base}' brain`
    return `${base}'s brain`
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
      const res = await apiFetch(`/api/chat/b2b/tunnel-timeline/${encodeURIComponent(h)}`)
      if (!res.ok) {
        loadError = $t('chat.tunnels.detailLoadFailed')
        return
      }
      const j = (await res.json()) as {
        timeline?: unknown
        inboundPolicy?: unknown
        peerDisplayName?: unknown
        inboundGrantId?: unknown
        outboundGrantId?: unknown
      }
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
      const pol = j.inboundPolicy
      if (pol === 'auto' || pol === 'review' || pol === 'ignore') policyDraft = pol

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
        await loadTimeline()
      }
    } finally {
      policyBusy = false
    }
  }

  async function sendBrain(): Promise<void> {
    const gid = outboundGrantId?.trim() ?? ''
    const text = composeBody.trim()
    if (!gid || !text) return
    sendError = null
    sending = true
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
        return
      }
      await res.text().catch(() => '')
      composeBody = ''
      await loadTimeline()
    } catch {
      sendError = 'network'
    } finally {
      sending = false
    }
  }

  function submitComposer() {
    if (recipient === 'human') {
      humanNotice = true
      setTimeout(() => (humanNotice = false), 5000)
      return
    }
    void sendBrain()
  }

  $effect(() => {
    void tunnelHandle
    peerDisplayName = peerDisplayNameInitial
    inboundGrantId = inboundGrantIdInitial ?? null
    outboundGrantId = outboundGrantIdInitial ?? null
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

<div class="tunnel-detail flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
  <header
    class="shrink-0 border-b border-border px-3 py-3 md:px-4"
    data-testid="tunnel-detail-header"
  >
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <h1 class="m-0 truncate text-base font-semibold text-foreground md:text-lg">{peerDisplayName}</h1>
        <div class="truncate text-[0.75rem] text-muted">@{tunnelHandle.trim()}</div>
      </div>

      {#if inboundGrantId}
        <label class="flex min-w-0 flex-col gap-1 text-[0.7rem] font-medium text-muted">
          {$t('chat.tunnels.autoRespondLabel')}
          <select
            data-testid="tunnel-detail-policy-select"
            class="rounded-md border border-border bg-background px-2 py-1.5 text-[0.8rem] text-foreground disabled:opacity-50"
            disabled={policyBusy}
            bind:value={policyDraft}
            onchange={(e) => void patchInboundPolicy(e.currentTarget.value as 'auto' | 'review' | 'ignore')}
          >
            <option value="review">{$t('chat.review.detail.policy.segment.review')}</option>
            <option value="auto">{$t('chat.review.detail.policy.segment.auto')}</option>
            <option value="ignore">{$t('chat.review.detail.policy.segment.ignore')}</option>
          </select>
        </label>
      {/if}
    </div>
  </header>

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
            actorLabel={actorLabelFor(item.actor, peerDisplayName)}
            body={item.body}
            hint={hintFor(item)}
            atMs={item.atMs}
            chatSessionId={item.chatSessionId ?? null}
            onclickOpenChat={onOpenOutboundChat}
          />
        {/if}
      {/each}
    </div>
  </div>

  {#if humanNotice}
    <p class="m-0 shrink-0 px-3 py-2 text-accent text-[0.8rem]" role="status">
      {$t('chat.tunnels.humanDmComingSoon')}
    </p>
  {/if}

  <footer class="tunnel-detail-compose shrink-0 border-t border-border bg-surface-2 px-3 py-2 md:px-4">
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-2">
      {#if sendError}
        <p class="m-0 text-danger text-[0.75rem]" role="alert">{sendError}</p>
      {/if}

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[0.7rem] text-muted">{$t('chat.tunnels.composeToLabel')}</span>
        <select
          class="rounded-full border border-border bg-background px-2 py-1 text-[0.75rem]"
          bind:value={recipient}
        >
          <option value="brain">{$t('chat.tunnels.recipientBrain')}</option>
          <option value="human">{$t('chat.tunnels.recipientHuman')}</option>
        </select>
      </div>

      <div class="flex w-full gap-2">
        <textarea
          class="box-border min-h-[2.75rem] flex-1 resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-[0.85rem]"
          placeholder={$t('chat.tunnels.composePlaceholderBrain', {
            peerPossessiveBrain: possessiveBrainLabel(peerDisplayName),
          })}
          bind:value={composeBody}
          disabled={sending || recipient === 'human' || !outboundGrantId}
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submitComposer()
            }
          }}
        ></textarea>
        <button
          type="button"
          class="shrink-0 self-end rounded-lg bg-accent px-3 py-2 text-[0.8rem] font-semibold text-white disabled:opacity-50"
          disabled={sending || !composeBody.trim() || recipient === 'human' || !outboundGrantId}
          onclick={() => submitComposer()}
        >
          {#if sending}
            …
          {:else}
            {$t('chat.history.coldQuery.send')}
          {/if}
        </button>
      </div>
      {#if !outboundGrantId}
        <p class="m-0 text-[0.7rem] text-muted">{$t('chat.tunnels.outboundUnavailable')}</p>
      {/if}
    </div>
  </footer>
</div>

<style>
</style>
