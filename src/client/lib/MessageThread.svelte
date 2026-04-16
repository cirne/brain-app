<script lang="ts">
  import type { SurfaceContext } from '../router.js'

  type CompactRow = { ts: number; m: number; t: string; r?: number }

  let {
    initialChat,
    onContextChange,
  }: {
    initialChat: string | undefined
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  let loading = $state(true)
  let errorText = $state<string | null>(null)
  let displayChat = $state('')
  let canonicalChat = $state('')
  let messages = $state<CompactRow[]>([])
  let total = $state(0)

  $effect(() => {
    if (!initialChat?.trim()) {
      loading = false
      errorText = null
      messages = []
      displayChat = ''
      canonicalChat = ''
      total = 0
      return
    }

    let cancelled = false
    loading = true
    errorText = null
    onContextChange?.({ type: 'messages', chat: initialChat.trim(), displayLabel: '(loading)' })

    const q = new URLSearchParams()
    q.set('chat', initialChat.trim())

    void (async () => {
      try {
        const res = await fetch(`/api/messages/thread?${q.toString()}`)
        const data = (await res.json()) as {
          ok?: boolean
          error?: string
          chat?: string
          canonical_chat?: string
          messages?: CompactRow[]
          total?: number
        }
        if (cancelled) return
        if (!res.ok || !data.ok) {
          errorText = data.error ?? `Request failed (${res.status})`
          loading = false
          return
        }
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
        if (!cancelled) errorText = e instanceof Error ? e.message : String(e)
      } finally {
        if (!cancelled) loading = false
      }
    })()

    return () => {
      cancelled = true
    }
  })

  function timeLabel(ts: number): string {
    try {
      return new Date(ts * 1000).toLocaleString(undefined, {
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
      {#each messages as row}
        <div class="msg-wrap" class:me={row.m === 1}>
          <div class="msg-meta">{timeLabel(row.ts)}{#if row.m !== 1 && row.r === 0}<span class="unread"> · Unread</span>{/if}</div>
          <div class="bubble">{row.t || ' '}</div>
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
    border-radius: 14px;
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
