<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fly } from 'svelte/transition'
  import { ChevronDown } from 'lucide-svelte'
  import { computePinnedToBottom } from '@client/lib/scrollPin.js'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { AgentConversationViewProps } from '@client/lib/agentConversationViewTypes.js'
  import ConversationEmptyState from './ConversationEmptyState.svelte'
  import ChatMessageRow from './ChatMessageRow.svelte'
  import CalendarDatePopover from './CalendarDatePopover.svelte'

  let {
    messages,
    streaming,
    onOpenWiki,
    onOpenFile,
    onOpenIndexedFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    onOpenMailSearchResults,
    onOpenWikiAbout,
    /** When set, shown instead of the default inbox/calendar empty state (e.g. onboarding). */
    empty,
    streamingWrite: _streamingWrite,
    multiTenant: _multiTenant = false,
    toolDisplayMode = 'compact',
  }: AgentConversationViewProps = $props()

  let messagesEl: HTMLElement | null = null
  let datePopover = $state<{ date: string; x: number; y: number } | null>(null)
  let datePopoverTimer: ReturnType<typeof setTimeout> | null = null

  let followOutput = $state(true)

  let ignoreScrollEvents = false

  let reduceMotion = $state(false)

  onMount(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reduceMotion = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  })

  const lastAssistantIndex = $derived.by(() => {
    for (let j = messages.length - 1; j >= 0; j -= 1) {
      if (messages[j].role === 'assistant') return j
    }
    return -1
  })

  const showJumpToLatest = $derived(!followOutput && messages.length > 0)

  const jumpTransitionMs = $derived(reduceMotion ? 0 : 200)

  function captureMessagesEl(element: HTMLElement) {
    messagesEl = element
    return () => {
      if (messagesEl === element) messagesEl = null
    }
  }

  function syncFollowFromScroll() {
    if (!messagesEl || ignoreScrollEvents) return
    followOutput = computePinnedToBottom(messagesEl)
  }

  export function scrollToBottom() {
    ignoreScrollEvents = true
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!messagesEl) {
            ignoreScrollEvents = false
            return
          }
          messagesEl.scrollTop = messagesEl.scrollHeight
          followOutput = true
          ignoreScrollEvents = false
        })
      })
    })
  }

  export function scrollToBottomIfFollowing() {
    if (!followOutput) return
    ignoreScrollEvents = true
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!messagesEl) {
            ignoreScrollEvents = false
            return
          }
          if (followOutput) {
            messagesEl.scrollTop = messagesEl.scrollHeight
          }
          ignoreScrollEvents = false
        })
      })
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

<div
  class={cn(
    'conversation-shell relative flex min-w-0 flex-col overflow-x-hidden',
    messages.length === 0 ? 'w-full flex-none' : 'min-h-0 flex-1',
  )}
  data-conversation-state={messages.length === 0 ? 'empty' : 'active'}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_mouse_events_have_key_events -->
  <div
    class={cn(
      'conversation chat-transcript-scroll min-w-0 overflow-x-hidden pb-[var(--composer-context-overlap-pad,0)]',
      messages.length === 0 ? 'flex flex-col overflow-y-visible' : 'min-h-0 flex-1 overflow-y-auto',
    )}
    {@attach captureMessagesEl}
    onscroll={syncFollowFromScroll}
    onclick={handleMessagesClick}
    onkeydown={handleMessagesKeydown}
    onmouseover={handleMessagesMouseOver}
    onmouseout={handleMessagesMouseOut}
  >
    <div class="chat-transcript-inner min-w-0 px-[length:var(--chat-transcript-px)]">
      {#if messages.length === 0}
        {#if empty}
          {@render empty()}
        {:else}
          <ConversationEmptyState
            {onOpenEmail}
            {onOpenFullInbox}
            {onSwitchToCalendar}
            {onOpenWikiAbout}
          />
        {/if}
      {/if}

      {#each messages as msg, i (msg.id)}
        <ChatMessageRow
          {msg}
          {streaming}
          isLastMessage={i === messages.length - 1}
          isLastAssistantInThread={i === lastAssistantIndex}
          {toolDisplayMode}
          {onOpenWiki}
          {onOpenFile}
          {onOpenIndexedFile}
          {onOpenEmail}
          {onOpenDraft}
          {onOpenFullInbox}
          {onSwitchToCalendar}
          {onOpenMessageThread}
          {onOpenMailSearchResults}
        />
      {/each}
    </div>
  </div>

  {#if showJumpToLatest}
    <div
      class="jump-anchor pointer-events-none absolute right-0 bottom-2.5 left-0 z-[3] flex justify-center md:[.split:not(.has-detail)_&]:mx-auto md:[.split:not(.has-detail)_&]:max-w-chat"
      in:fly={{ y: 10, duration: jumpTransitionMs }}
      out:fly={{ y: 8, duration: Math.min(jumpTransitionMs, 160) }}
    >
      <button
        type="button"
        class={cn(
          'jump-to-latest pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] py-[9px] pr-4 pl-3.5 text-xs font-semibold tracking-[0.04em] text-foreground uppercase shadow-[0_2px_4px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.1)] backdrop-blur-[10px] transition-[transform,box-shadow,border-color] duration-[180ms] ease-in-out [-webkit-backdrop-filter:blur(10px)] hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--accent)_35%,var(--border))] hover:shadow-[0_4px_8px_rgba(0,0,0,0.06),0_12px_28px_rgba(0,0,0,0.12)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 motion-reduce:hover:translate-y-0 dark:bg-[color-mix(in_srgb,var(--bg-3)_92%,transparent)] dark:shadow-[0_2px_4px_rgba(0,0,0,0.2),0_10px_28px_rgba(0,0,0,0.45)]',
          streaming && 'streaming border-[color-mix(in_srgb,var(--accent)_28%,var(--border))]',
        )}
        aria-label={streaming
          ? $t('chat.agentConversation.jumpToLatestStreamingAria')
          : $t('chat.agentConversation.jumpToLatestAria')}
        onclick={() => scrollToBottom()}
      >
        {#if streaming}
          <span
            class="live-pulse h-[7px] w-[7px] shrink-0 bg-accent shadow-[0_0_0_0_color-mix(in_srgb,var(--accent)_45%,transparent)]"
            aria-hidden="true"
          ></span>
        {/if}
        <ChevronDown size={16} strokeWidth={2.25} class="jump-chevron shrink-0 opacity-85" aria-hidden="true" />
        <span class="jump-text leading-none">{$t('chat.agentConversation.latest')}</span>
      </button>
    </div>
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
  .live-pulse {
    animation: jump-live-pulse 1.8s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .live-pulse {
      animation: none;
      opacity: 1;
    }
  }

  @keyframes jump-live-pulse {
    0%, 100% {
      opacity: 1;
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 40%, transparent);
    }
    50% {
      opacity: 0.75;
      box-shadow: 0 0 0 6px transparent;
    }
  }
</style>
