<script lang="ts">
  import type { Snippet } from 'svelte'
  import { extractReferencedFiles, type ChatMessage } from '../agentUtils.js'
  import ConversationEmptyState from './ConversationEmptyState.svelte'
  import ChatMessageRow from './ChatMessageRow.svelte'
  import ReferencedFilesStrip from './ReferencedFilesStrip.svelte'
  import CalendarDatePopover from './CalendarDatePopover.svelte'

  let {
    messages,
    streaming,
    onOpenWiki,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    /** When set, shown instead of the default inbox/calendar empty state (e.g. onboarding). */
    empty,
  }: {
    messages: ChatMessage[]
    streaming: boolean
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    empty?: Snippet
  } = $props()

  let messagesEl: HTMLElement
  let datePopover = $state<{ date: string; x: number; y: number } | null>(null)
  let datePopoverTimer: ReturnType<typeof setTimeout> | null = null

  const referencedFiles = $derived(extractReferencedFiles(messages))

  export function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight
    })
  }

  function activateMessagesTarget(e: UIEvent) {
    const dateBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')
    if (dateBtn) {
      e.stopPropagation()
      onSwitchToCalendar?.(dateBtn.dataset.date!)
      return
    }
    const wikiBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-wiki]')
    if (wikiBtn) {
      e.stopPropagation()
      onOpenWiki?.(wikiBtn.dataset.wiki!)
    }
  }

  function handleMessagesClick(e: MouseEvent) {
    activateMessagesTarget(e)
  }

  function handleMessagesKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    activateMessagesTarget(e)
  }

  function handleMessagesMouseOver(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')
    if (!btn) return
    clearTimeout(datePopoverTimer!)
    const date = btn.dataset.date!
    const rect = btn.getBoundingClientRect()
    const x = Math.min(rect.left, window.innerWidth - 260)
    const y = rect.bottom + 6
    datePopover = { date, x, y }
  }

  function handleMessagesMouseOut(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')
    if (!btn) return
    clearTimeout(datePopoverTimer!)
    datePopoverTimer = setTimeout(() => {
      datePopover = null
    }, 200)
  }

  function keepPopover() {
    clearTimeout(datePopoverTimer!)
  }
  function startClosePopover() {
    datePopoverTimer = setTimeout(() => {
      datePopover = null
    }, 150)
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div
  class="conversation"
  bind:this={messagesEl}
  onclick={handleMessagesClick}
  onkeydown={handleMessagesKeydown}
  onmouseover={handleMessagesMouseOver}
  onmouseout={handleMessagesMouseOut}
>
  {#if messages.length === 0}
    {#if empty}
      {@render empty()}
    {:else}
      <ConversationEmptyState {onOpenEmail} {onOpenFullInbox} {onSwitchToCalendar} />
    {/if}
  {/if}

  {#each messages as msg, i (i)}
    <ChatMessageRow
      {msg}
      {streaming}
      isLastMessage={i === messages.length - 1}
      {onOpenWiki}
      {onOpenEmail}
      {onOpenFullInbox}
      {onSwitchToCalendar}
      {onOpenMessageThread}
    />
  {/each}

  {#if referencedFiles.length > 0}
    <ReferencedFilesStrip paths={referencedFiles} {onOpenWiki} />
  {/if}
</div>

{#if datePopover}
  <CalendarDatePopover
    date={datePopover.date}
    x={datePopover.x}
    y={datePopover.y}
    onKeep={keepPopover}
    onStartClose={startClosePopover}
  />
{/if}

<style>
  .conversation {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    box-sizing: border-box;
  }

  @media (min-width: 768px) {
    :global(.split:not(.has-detail)) .conversation {
      max-width: var(--chat-column-max);
      margin-left: auto;
      margin-right: auto;
      width: 100%;
    }
  }
</style>
