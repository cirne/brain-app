<script lang="ts">
  import { MessageSquare } from 'lucide-svelte'

  type PreviewMsg = { ts: number; m: number; t: string; r?: number }

  let {
    displayChat,
    snippet,
    previewMessages = [],
    total = 0,
    n = 0,
    person = [],
    onOpen,
  }: {
    displayChat: string
    snippet: string
    previewMessages?: PreviewMsg[]
    total?: number
    n?: number
    person?: string[]
    onOpen: () => void
  } = $props()

  const tail = $derived(previewMessages.slice(-3))

  function timeLabel(ts: number): string {
    try {
      return new Date(ts * 1000).toLocaleString(undefined, {
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
  class="imessage-card"
  onclick={onOpen}
  aria-label="Open iMessage thread: {displayChat}"
>
  <div class="imessage-row">
    <MessageSquare size={14} aria-hidden="true" />
    <span class="imessage-chat">{displayChat}</span>
  </div>
  {#if person.length > 0}
    <div class="imessage-person">{person.join(' · ')}</div>
  {/if}
  {#if snippet}
    <p class="imessage-snippet">{snippet}</p>
  {/if}
  {#if total > 0 || n > 0}
    <div class="imessage-meta">{n} shown · {total} in window</div>
  {/if}
  {#if tail.length > 0}
    <div class="imessage-bubbles" aria-hidden="true">
      {#each tail as row}
        <div class="bubble-row" class:me={row.m === 1}>
          <span class="bubble">{bubblePreviewText(row.t)}</span>
          <span class="bubble-time">{timeLabel(row.ts)}</span>
        </div>
      {/each}
    </div>
  {/if}
</button>

<style>
  .imessage-card {
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-3);
    display: block;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .imessage-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .imessage-chat {
    font-size: 13px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .imessage-person {
    font-size: 11px;
    color: var(--text-2);
    margin-top: 4px;
  }
  .imessage-snippet {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-2);
  }
  .imessage-meta {
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-2);
  }
  .imessage-bubbles {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 140px;
    overflow: hidden;
  }
  .bubble-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    max-width: 100%;
  }
  .bubble-row.me {
    align-items: flex-end;
  }
  .bubble {
    font-size: 12px;
    line-height: 1.35;
    padding: 6px 10px;
    border-radius: 12px;
    background: var(--bg-2);
    color: var(--text);
    max-width: 92%;
    word-break: break-word;
  }
  .bubble-row.me .bubble {
    background: var(--accent-dim);
  }
  .bubble-time {
    font-size: 10px;
    color: var(--text-2);
    padding: 0 4px;
  }
</style>
