<script lang="ts">
  import { cn } from '@client/lib/cn.js'
  import type { SurfaceContext } from '@client/router.js'
  import { FDA_GATE_OPEN_EVENT } from '@client/lib/onboarding/fdaGateKeys.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import { t } from '@client/lib/i18n/index.js'

  type CompactRow = {
    sent_at_unix: number
    is_from_me: boolean
    text: string
    is_read?: boolean
  }

  let {
    initialChat,
    onContextChange,
  }: {
    initialChat: string | undefined
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  let loading = $state(true)
  let errorText = $state<string | null>(null)
  let fullDiskAccessHint = $state(false)
  let displayChat = $state('')
  let canonicalChat = $state('')
  let messages = $state<CompactRow[]>([])
  let total = $state(0)

  const threadFetchLatest = createAsyncLatest({ abortPrevious: true })

  $effect(() => {
    if (!initialChat?.trim()) {
      threadFetchLatest.begin()
      loading = false
      errorText = null
      fullDiskAccessHint = false
      messages = []
      displayChat = ''
      canonicalChat = ''
      total = 0
      return
    }

    const { token, signal } = threadFetchLatest.begin()
    loading = true
    errorText = null
    fullDiskAccessHint = false
    onContextChange?.({
      type: 'messages',
      chat: initialChat.trim(),
      displayLabel: $t('inbox.messageThread.loadingLabel'),
    })

    const q = new URLSearchParams()
    q.set('chat', initialChat.trim())

    void (async () => {
      try {
        const res = await fetch(`/api/messages/thread?${q.toString()}`, { signal })
        if (threadFetchLatest.isStale(token)) return
        const data = (await res.json()) as {
          ok?: boolean
          error?: string
          full_disk_access_hint?: boolean
          chat?: string
          canonical_chat?: string
          messages?: CompactRow[]
          total?: number
        }
        if (threadFetchLatest.isStale(token)) return
        if (!res.ok || !data.ok) {
          errorText =
            data.error ?? $t('inbox.messageThread.errors.requestFailedWithStatus', { status: res.status })
          fullDiskAccessHint = data.full_disk_access_hint === true
          return
        }
        fullDiskAccessHint = false
        displayChat = data.chat ?? initialChat
        canonicalChat = data.canonical_chat ?? initialChat
        messages = Array.isArray(data.messages) ? data.messages : []
        total = typeof data.total === 'number' ? data.total : messages.length
        onContextChange?.({
          type: 'messages',
          chat: canonicalChat,
          displayLabel: displayChat,
        })
      } catch (e) {
        if (threadFetchLatest.isStale(token) || isAbortError(e)) return
        errorText = e instanceof Error ? e.message : String(e)
      } finally {
        if (!threadFetchLatest.isStale(token)) loading = false
      }
    })()

    return () => {
      threadFetchLatest.begin()
    }
  })

  function openFdaGateFromHint() {
    window.dispatchEvent(new CustomEvent(FDA_GATE_OPEN_EVENT))
  }

  function timeLabel(sentAtUnix: number): string {
    try {
      return new Date(sentAtUnix * 1000).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return ''
    }
  }
</script>

<div
  class="message-thread-panel flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 pb-5 pt-3"
>
  {#if !initialChat?.trim()}
    <p class="status m-0 text-[13px] text-muted">{$t('inbox.messageThread.empty.openFromAgent')}</p>
  {:else if loading}
    <p class="status m-0 text-[13px] text-muted">{$t('inbox.messageThread.loadingMessages')}</p>
  {:else if errorText}
    <p class="status error m-0 text-[13px] text-[var(--danger,#f87171)]">{errorText}</p>
    {#if fullDiskAccessHint}
      <p class="status fda-hint m-0 mt-3 text-[13px] text-muted">
        <button
          type="button"
          class="fda-grant-link cursor-pointer border-none bg-none p-0 text-accent underline [text-underline-offset:3px] [font:inherit] hover:[filter:brightness(1.1)]"
          onclick={openFdaGateFromHint}
        >{$t('inbox.messageThread.actions.grantFullDiskAccess')}</button>
      </p>
    {/if}
  {:else if messages.length === 0}
    <p class="status m-0 text-[13px] text-muted">{$t('inbox.messageThread.empty.noMessagesInWindow')}</p>
  {:else}
    <div class="thread-meta mb-3">
      {#if total > messages.length}
        <span class="meta-count text-[11px] text-muted">{$t('inbox.messageThread.meta.loadedInRange', { loaded: messages.length, total })}</span>
      {:else}
        <span class="meta-count text-[11px] text-muted">{$t('inbox.messageThread.meta.messagesCount', { count: messages.length })}</span>
      {/if}
    </div>
    <div class="bubble-list flex flex-col gap-3">
      {#each messages as row, i (`${row.sent_at_unix}-${i}`)}
        <div
          class={cn(
            'msg-wrap flex max-w-full flex-col items-start',
            row.is_from_me && 'me items-end',
          )}
        >
          <div class="msg-meta mb-1 px-1.5 text-[10px] text-muted">{timeLabel(row.sent_at_unix)}{#if !row.is_from_me && row.is_read === false}<span class="unread text-accent"> · {$t('inbox.messageThread.status.unread')}</span>{/if}</div>
          <div
            class={cn(
              'bubble max-w-[min(92%,520px)] whitespace-pre-wrap [word-break:break-word] bg-surface-2 px-3 py-2 text-sm leading-snug text-foreground',
              row.is_from_me && 'bg-accent-dim',
            )}
          >{row.text || ' '}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>
