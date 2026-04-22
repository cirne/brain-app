<script lang="ts">
  import { MessageSquare } from 'lucide-svelte'

  type PreviewMsg = {
    sent_at_unix: number
    is_from_me: boolean
    text: string
    is_read?: boolean
  }

  let {
    displayChat,
    snippet,
    previewMessages = [],
    total = 0,
    returnedCount = 0,
    person = [],
    onOpen,
  }: {
    displayChat: string
    snippet: string
    previewMessages?: PreviewMsg[]
    total?: number
    returnedCount?: number
    person?: string[]
    onOpen: () => void
  } = $props()

  const tail = $derived(previewMessages.slice(-3))

  function timeLabel(sentAtUnix: number): string {
    try {
      return new Date(sentAtUnix * 1000).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return ''
    }
  }

  function bubblePreviewText(t: unknown): string {
    const raw = String(t ?? '')
    return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw || ' '
  }
</script>

<button
  type="button"
  class="message-thread-preview"
  onclick={onOpen}
  aria-label="Open message thread: {displayChat}"
>
  <div class="message-thread-row">
    <MessageSquare size={14} aria-hidden="true" />
    <span class="message-thread-chat">{displayChat}</span>
  </div>
  {#if person.length > 0}
    <div class="message-thread-person">{person.join(' · ')}</div>
  {/if}
  {#if snippet}
    <p class="message-thread-snippet">{snippet}</p>
  {/if}
  {#if total > 0 || returnedCount > 0}
    <div class="message-thread-meta">{returnedCount} shown · {total} in window</div>
  {/if}
  {#if tail.length > 0}
    <div class="message-thread-lines" aria-hidden="true">
      {#each tail as row, i (`${row.sent_at_unix}-${i}`)}
        <div class="message-line" class:me={row.is_from_me}>
          <span class="message-line-text">{bubblePreviewText(row.text)}</span>
          <span class="message-line-time">{timeLabel(row.sent_at_unix)}</span>
        </div>
      {/each}
    </div>
  {/if}
</button>

<style>
  .message-thread-preview {
    margin: 4px 0 0;
    padding: 4px 0;
    display: block;
    width: 100%;
    max-width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    border: none;
    background: transparent;
    min-width: 0;
  }

  .message-thread-preview:hover .message-thread-chat {
    color: var(--accent);
  }

  .message-thread-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .message-thread-chat {
    font-size: 13px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .message-thread-person {
    font-size: 11px;
    color: var(--text-2);
    margin-top: 4px;
  }

  .message-thread-snippet {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-2);
  }

  .message-thread-meta {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-2);
  }

  .message-thread-lines {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 140px;
    overflow: hidden;
    padding-top: 6px;
    border-top: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }

  .message-line {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    max-width: 100%;
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-2);
  }

  .message-line.me {
    align-items: flex-end;
    color: var(--text);
  }

  .message-line-text {
    word-break: break-word;
  }

  .message-line-time {
    font-size: 10px;
    color: var(--text-2);
  }
</style>
