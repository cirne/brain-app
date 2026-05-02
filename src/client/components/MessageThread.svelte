<script lang="ts">
  import type { SurfaceContext } from '@client/router.js'
  import { FDA_GATE_OPEN_EVENT } from '@client/lib/onboarding/fdaGateKeys.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

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
    onContextChange?.({ type: 'messages', chat: initialChat.trim(), displayLabel: '(loading)' })

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
          errorText = data.error ?? `Request failed (${res.status})`
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

<div class="message-thread-panel">
  {#if !initialChat?.trim()}
    <p class="status">Open a thread from the agent (get_message_thread) to view messages here.</p>
  {:else if loading}
    <p class="status">Loading messages…</p>
  {:else if errorText}
    <p class="status error">{errorText}</p>
    {#if fullDiskAccessHint}
      <p class="status fda-hint">
        <button type="button" class="fda-grant-link" onclick={openFdaGateFromHint}>Grant Full Disk Access…</button>
      </p>
    {/if}
  {:else if messages.length === 0}
    <p class="status">No messages in the current time window.</p>
  {:else}
    <div class="thread-meta">
      {#if total > messages.length}
        <span class="meta-count">{messages.length} loaded · {total} in range</span>
      {:else}
        <span class="meta-count">{messages.length} messages</span>
      {/if}
    </div>
    <div class="bubble-list">
      {#each messages as row, i (`${row.sent_at_unix}-${i}`)}
        <div class="msg-wrap" class:me={row.is_from_me}>
          <div class="msg-meta">{timeLabel(row.sent_at_unix)}{#if !row.is_from_me && row.is_read === false}<span class="unread"> · Unread</span>{/if}</div>
          <div class="bubble">{row.text || ' '}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .message-thread-panel {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px 20px;
    display: flex;
    flex-direction: column;
  }
  .status {
    margin: 0;
    font-size: 13px;
    color: var(--text-2);
  }
  .status.error {
    color: var(--danger, #f87171);
  }
  .fda-hint {
    margin-top: 0.75rem;
  }
  .fda-grant-link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .fda-grant-link:hover {
    filter: brightness(1.1);
  }
  .thread-meta {
    margin-bottom: 12px;
  }
  .meta-count {
    font-size: 11px;
    color: var(--text-2);
  }
  .bubble-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .msg-wrap {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 100%;
  }
  .msg-wrap.me {
    align-items: flex-end;
  }
  .msg-meta {
    font-size: 10px;
    color: var(--text-2);
    margin-bottom: 4px;
    padding: 0 6px;
  }
  .unread {
    color: var(--accent);
  }
  .bubble {
    font-size: 14px;
    line-height: 1.45;
    padding: 8px 12px;
background: var(--bg-2);
    color: var(--text);
    max-width: min(92%, 520px);
    word-break: break-word;
    white-space: pre-wrap;
  }
  .msg-wrap.me .bubble {
    background: var(--accent-dim);
  }
</style>
