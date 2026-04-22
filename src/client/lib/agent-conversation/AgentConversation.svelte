<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fly } from 'svelte/transition'
  import { ChevronDown } from 'lucide-svelte'
  import { computePinnedToBottom } from '../scrollPin.js'
  import { extractReferencedFiles } from '../agentUtils.js'
  import type { AgentConversationViewProps } from '../agentConversationViewTypes.js'
  import ConversationEmptyState from './ConversationEmptyState.svelte'
  import ChatMessageRow from './ChatMessageRow.svelte'
  import ReferencedFilesStrip from './ReferencedFilesStrip.svelte'
  import CalendarDatePopover from './CalendarDatePopover.svelte'

  let {
    messages,
    streaming,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    /** When set, shown instead of the default inbox/calendar empty state (e.g. onboarding). */
    empty,
    streamingWrite: _streamingWrite,
    multiTenant: _multiTenant = false,
  }: AgentConversationViewProps = $props()

  let messagesEl: HTMLElement
  let datePopover = $state<{ date: string; x: number; y: number } | null>(null)
  let datePopoverTimer: ReturnType<typeof setTimeout> | null = null

  /** When true, new assistant content auto-scrolls the viewport (until the user scrolls up). BUG-007. */
  let followOutput = $state(true)

  /** Temporarily ignore scroll events during programmatic scrolls to prevent followOutput from toggling off. */
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

  const referencedFiles = $derived(extractReferencedFiles(messages))

  const showJumpToLatest = $derived(!followOutput && messages.length > 0)

  const jumpTransitionMs = $derived(reduceMotion ? 0 : 200)

  function syncFollowFromScroll() {
    if (!messagesEl || ignoreScrollEvents) return
    followOutput = computePinnedToBottom(messagesEl)
  }

  /** Unconditional scroll + resume follow mode (load session, stream finished, user just sent). */
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

  /** Stream deltas: only scroll if the user has not scrolled away to read history. */
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

<div class="conversation-shell" data-conversation-state={messages.length === 0 ? 'empty' : 'active'}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_mouse_events_have_key_events -->
  <div
    class="conversation chat-transcript-scroll"
    bind:this={messagesEl}
    onscroll={syncFollowFromScroll}
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
        {onOpenFile}
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

  {#if showJumpToLatest}
    <div
      class="jump-anchor"
      in:fly={{ y: 10, duration: jumpTransitionMs }}
      out:fly={{ y: 8, duration: Math.min(jumpTransitionMs, 160) }}
    >
      <button
        type="button"
        class="jump-to-latest"
        class:streaming={streaming}
        aria-label={streaming ? 'Jump to latest, reply in progress' : 'Jump to latest messages'}
        onclick={() => scrollToBottom()}
      >
        {#if streaming}
          <span class="live-pulse" aria-hidden="true"></span>
        {/if}
        <ChevronDown size={16} strokeWidth={2.25} class="jump-chevron" aria-hidden="true" />
        <span class="jump-text">Latest</span>
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
  .conversation-shell {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow-x: hidden;
  }

  .conversation-shell[data-conversation-state='empty'] {
    flex: 0 1 auto;
    min-height: 0;
  }

  .conversation {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .conversation-shell[data-conversation-state='empty'] .conversation {
    flex: 0 1 auto;
    max-height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
  }

  @media (min-width: 768px) {
    :global(.split:not(.has-detail)) .jump-anchor {
      max-width: var(--chat-column-max);
      margin-left: auto;
      margin-right: auto;
    }
  }

  .jump-anchor {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 10px;
    display: flex;
    justify-content: center;
    pointer-events: none;
    z-index: 3;
  }

  .jump-to-latest {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px 9px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--border);
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.04),
      0 8px 24px rgba(0, 0, 0, 0.1);
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      border-color 0.18s ease;
  }

  @media (prefers-color-scheme: dark) {
    .jump-to-latest {
      background: color-mix(in srgb, var(--bg-3) 92%, transparent);
      box-shadow:
        0 2px 4px rgba(0, 0, 0, 0.2),
        0 10px 28px rgba(0, 0, 0, 0.45);
    }
  }

  .jump-to-latest:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    box-shadow:
      0 4px 8px rgba(0, 0, 0, 0.06),
      0 12px 28px rgba(0, 0, 0, 0.12);
  }

  .jump-to-latest:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .jump-to-latest:active {
    transform: translateY(0);
  }

  .jump-to-latest.streaming {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  }

  .jump-to-latest :global(.jump-chevron) {
    flex-shrink: 0;
    opacity: 0.85;
  }

  .live-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--accent);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent);
    animation: jump-live-pulse 1.8s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .live-pulse {
      animation: none;
      opacity: 1;
    }
    .jump-to-latest:hover {
      transform: none;
    }
  }

  @keyframes jump-live-pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 40%, transparent);
    }
    50% {
      opacity: 0.75;
      box-shadow: 0 0 0 6px transparent;
    }
  }

  .jump-text {
    line-height: 1;
  }
</style>
