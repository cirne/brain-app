<script lang="ts">
  import { MessageSquare } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'

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
  class="message-thread-preview group mt-1 block w-full min-w-0 max-w-full cursor-pointer border-none bg-transparent px-0 py-1 text-left font-[inherit] text-[inherit]"
  onclick={onOpen}
  aria-label={$t('cards.messageThreadPreviewCard.ariaOpenMessageThread', { displayChat })}
>
  <div class="message-thread-row flex min-w-0 items-center gap-2">
    <MessageSquare size={14} aria-hidden="true" />
    <span class="message-thread-chat min-w-0 truncate text-[13px] font-semibold group-hover:text-accent">{displayChat}</span>
  </div>
  {#if person.length > 0}
    <div class="message-thread-person mt-1 text-[11px] text-muted">{person.join(' · ')}</div>
  {/if}
  {#if snippet}
    <p class="message-thread-snippet mt-2 text-xs leading-[1.4] text-muted">{snippet}</p>
  {/if}
  {#if total > 0 || returnedCount > 0}
    <div class="message-thread-meta mt-1.5 text-[11px] text-muted">
      {$t('cards.messageThreadPreviewCard.shownInWindow', { shown: returnedCount, total })}
    </div>
  {/if}
  {#if tail.length > 0}
    <div
      class="message-thread-lines mt-2 flex max-h-[140px] flex-col gap-1 overflow-hidden border-t border-[color-mix(in_srgb,var(--border)_55%,transparent)] pt-1.5"
      aria-hidden="true"
    >
      {#each tail as row, i (`${row.sent_at_unix}-${i}`)}
        <div
          class={cn(
            'message-line flex max-w-full flex-col items-start gap-[2px] text-xs leading-[1.35] text-muted',
            row.is_from_me && 'me items-end text-foreground',
          )}
        >
          <span class="message-line-text break-words">{bubblePreviewText(row.text)}</span>
          <span class="message-line-time text-[10px] text-muted">{timeLabel(row.sent_at_unix)}</span>
        </div>
      {/each}
    </div>
  {/if}
</button>
