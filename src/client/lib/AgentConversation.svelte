<script lang="ts">
  import { onMount } from 'svelte'
  import { renderMarkdown } from './markdown.js'
  import DayEvents from './DayEvents.svelte'
  import { getToolIcon } from './toolIcons.js'
  import WikiFileName from './WikiFileName.svelte'
  import { extractReferencedFiles, type ChatMessage } from './agentUtils.js'
  import { matchContentPreview } from './cards/contentCards.js'
  import CalendarPreviewCard from './cards/CalendarPreviewCard.svelte'
  import WikiPreviewCard from './cards/WikiPreviewCard.svelte'
  import EmailPreviewCard from './cards/EmailPreviewCard.svelte'
  import InboxListPreviewCard from './cards/InboxListPreviewCard.svelte'
  import { inboxRowsToPreviewItems } from '../../server/lib/ripmailInboxFlatten.js'
  import type { CalendarEventLite, InboxListItemPreview } from './cards/contentCards.js'

  let {
    messages,
    streaming,
    onOpenWiki,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
  }: {
    messages: ChatMessage[]
    streaming: boolean
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    /** Opens the inbox surface without a specific thread (SlideOver / route). */
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
  } = $props()

  let messagesEl: HTMLElement
  let datePopover = $state<{ date: string; x: number; y: number } | null>(null)
  let datePopoverTimer: ReturnType<typeof setTimeout> | null = null

  const referencedFiles = $derived(extractReferencedFiles(messages))

  let emptyPreviewLoading = $state(false)
  let emptyInboxPreviewRows = $state<InboxListItemPreview[]>([])
  let emptyCalendarEvents = $state<CalendarEventLite[]>([])
  /** Date key used for the last `loadEmptyPreviews` calendar fetch (YYYY-MM-DD). */
  let emptyPreviewDay = $state(new Date().toISOString().slice(0, 10))
  let prevMessageCount = $state(-1)

  async function loadEmptyPreviews() {
    emptyPreviewLoading = true
    const todayYmd = new Date().toISOString().slice(0, 10)
    emptyPreviewDay = todayYmd
    try {
      const [inboxRes, calRes] = await Promise.all([
        fetch('/api/inbox'),
        fetch(`/api/calendar?start=${todayYmd}&end=${todayYmd}`),
      ])
      const inboxJson = inboxRes.ok ? await inboxRes.json() : []
      const rows = Array.isArray(inboxJson) ? inboxJson : []
      emptyInboxPreviewRows = inboxRowsToPreviewItems(rows)

      const calData = calRes.ok ? await calRes.json() : { events: [] }
      emptyCalendarEvents = Array.isArray(calData.events) ? calData.events : []
    } catch {
      emptyInboxPreviewRows = []
      emptyCalendarEvents = []
    } finally {
      emptyPreviewLoading = false
    }
  }

  onMount(() => {
    if (messages.length === 0) void loadEmptyPreviews()
  })

  $effect(() => {
    const len = messages.length
    if (len === 0 && prevMessageCount > 0) {
      void loadEmptyPreviews()
    }
    prevMessageCount = len
  })

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
    datePopoverTimer = setTimeout(() => { datePopover = null }, 200)
  }

  function keepPopover() { clearTimeout(datePopoverTimer!) }
  function startClosePopover() { datePopoverTimer = setTimeout(() => { datePopover = null }, 150) }

  function formatArgs(args: any): string {
    if (!args) return ''
    try { return JSON.stringify(args, null, 2) } catch { return String(args) }
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
    <div class="empty-state">
      <div class="empty-intro">
        <p>Ask anything about your docs, email, or calendar.</p>
        <p class="hint">Use <kbd>@</kbd> to reference docs in this app.</p>
      </div>
      {#if emptyPreviewLoading}
        <p class="empty-loading">Loading calendar and inbox…</p>
      {:else}
        <div class="empty-previews">
          <CalendarPreviewCard
            start={emptyPreviewDay}
            end={emptyPreviewDay}
            events={emptyCalendarEvents}
            onOpenCalendar={(date) => onSwitchToCalendar?.(date)}
            onOpenCalendarEvent={(date, eventId) => onSwitchToCalendar?.(date, eventId)}
          />
          <InboxListPreviewCard
            items={emptyInboxPreviewRows}
            totalCount={emptyInboxPreviewRows.length}
            onOpenEmail={(id, subject, from) => onOpenEmail?.(id, subject, from)}
            onOpenFullInbox={onOpenFullInbox}
          />
        </div>
      {/if}
    </div>
  {/if}

  {#each messages as msg, i}
    <div class="message {msg.role}">
      {#if msg.role === 'user'}
        <div class="msg-label">You</div>
        <div class="msg-content user-content">{msg.content}</div>
      {:else}
        <div class="msg-label">Assistant</div>

        {#each msg.parts ?? [] as part}
          <!-- write: live preview is in the wiki pane; other tools: show only when done (no "running" rows) -->
          {#if part.type === 'tool' && part.toolCall.name !== 'set_chat_title' && part.toolCall.name !== 'write'}
            {#if part.toolCall.done}
            {@const preview = matchContentPreview(part.toolCall)}
            <div class="tool-part">
              <details class="tool-call" class:error={part.toolCall.isError} open={!part.toolCall.done}>
                <summary>
                  <span class="tool-icon">
                    {#if part.toolCall.isError}
                      !
                    {:else if !part.toolCall.done}
                      <svg class="spin" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    {:else}
                      {@const Icon = getToolIcon(part.toolCall.name)}
                      {#if Icon}
                        <Icon size={12} strokeWidth={2.5} />
                      {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                      {/if}
                    {/if}
                  </span>
                  <span class="tool-name">{part.toolCall.name}</span>
                  {#if !part.toolCall.done}
                    <span class="tool-status">running</span>
                  {/if}
                </summary>
                {#if part.toolCall.args}
                  <pre class="tool-args">{formatArgs(part.toolCall.args)}</pre>
                {/if}
                {#if part.toolCall.result}
                  <pre class="tool-result" class:tool-error={part.toolCall.isError} class:muted={!!preview}>{part.toolCall.result}</pre>
                {/if}
              </details>
              {#if preview?.kind === 'calendar'}
                <CalendarPreviewCard
                  start={preview.start}
                  end={preview.end}
                  events={preview.events}
                  onOpenCalendar={(date) => onSwitchToCalendar?.(date)}
                  onOpenCalendarEvent={(date, eventId) => onSwitchToCalendar?.(date, eventId)}
                />
              {:else if preview?.kind === 'wiki'}
                <WikiPreviewCard
                  path={preview.path}
                  excerpt={preview.excerpt}
                  onOpen={() => onOpenWiki?.(preview.path)}
                />
              {:else if preview?.kind === 'email'}
                <EmailPreviewCard
                  subject={preview.subject}
                  from={preview.from}
                  snippet={preview.snippet}
                  onOpen={() => onOpenEmail?.(preview.id, preview.subject, preview.from)}
                />
              {:else if preview?.kind === 'inbox_list'}
                <InboxListPreviewCard
                  items={preview.items}
                  totalCount={preview.totalCount}
                  onOpenEmail={(id, subject, from) => onOpenEmail?.(id, subject, from)}
                  onOpenFullInbox={onOpenFullInbox}
                />
              {/if}
            </div>
            {/if}
          {:else if part.type === 'text' && part.content}
            <div class="msg-content markdown">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderMarkdown(part.content)}
            </div>
          {/if}
        {/each}

        {#if streaming && i === messages.length - 1 && !msg.parts?.length}
          <div class="msg-content"><span class="cursor">|</span></div>
        {/if}
      {/if}
    </div>
  {/each}

  {#if referencedFiles.length > 0}
    <div class="referenced-files">
      <div class="referenced-label">Referenced</div>
      <div class="referenced-list">
        {#each referencedFiles as path}
          <button class="referenced-item" onclick={() => onOpenWiki?.(path)}>
            <WikiFileName {path} />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

{#if datePopover}
  <div class="date-popover" role="tooltip" style="left:{datePopover.x}px;top:{datePopover.y}px"
    onmouseenter={keepPopover} onmouseleave={startClosePopover}>
    <div class="date-popover-header">
      {new Date(datePopover.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
    </div>
    <DayEvents date={datePopover.date} />
  </div>
{/if}

<style>
  .conversation {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    box-sizing: border-box;
  }

  /* Full-width chat only: center readable column (split view keeps full width of chat pane) */
  @media (min-width: 768px) {
    :global(.split:not(.has-detail)) .conversation {
      max-width: var(--chat-column-max);
      margin-left: auto;
      margin-right: auto;
      width: 100%;
    }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    min-height: 100%;
    color: var(--text-2);
    font-size: 14px;
    gap: 8px;
    padding-bottom: 24px;
    box-sizing: border-box;
  }

  .empty-intro {
    text-align: center;
    width: 100%;
  }

  .empty-loading {
    margin: 12px 0 0;
    font-size: 12px;
    color: var(--text-2);
    opacity: 0.75;
    text-align: center;
  }

  .empty-previews {
    width: 100%;
    max-width: 800px;
    margin: 12px auto 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-self: center;
  }

  .empty-previews :global(.inbox-list-card),
  .empty-previews :global(.calendar-card) {
    margin-left: 0;
    margin-right: 0;
  }

  .hint {
    font-size: 12px;
    opacity: 0.7;
  }

  .hint kbd {
    background: var(--bg-3);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: inherit;
    font-size: 12px;
  }

  .message {
    margin-bottom: 20px;
    max-width: 800px;
  }

  .message.user {
    border-left: 2px solid var(--border);
    padding-left: 10px;
    opacity: 0.7;
  }

  .msg-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
    margin-bottom: 4px;
  }

  .user-content {
    color: var(--text);
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.5;
  }

  .tool-part {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 4px 0 12px;
  }

  .tool-call {
    margin: 0;
    border-radius: 4px;
    font-size: 13px;
    overflow: hidden;
  }

  .tool-call summary {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 4px;
    cursor: pointer;
    user-select: none;
    list-style: none;
  }
  .tool-call summary::-webkit-details-marker { display: none; }

  .tool-icon {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-2);
  }

  .tool-call.error .tool-icon { color: var(--danger); }

  .tool-icon .spin { animation: tool-spin 1s linear infinite; }
  @keyframes tool-spin { to { transform: rotate(360deg); } }

  .tool-name {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-2);
  }

  .tool-status {
    font-size: 11px;
    color: var(--text-2);
    margin-left: auto;
  }

  .tool-args, .tool-result {
    margin: 0;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.4;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 1px solid var(--border);
    color: var(--text-2);
    background: var(--bg);
  }

  .tool-error { color: var(--danger); }

  .tool-result.muted {
    max-height: 80px;
    opacity: 0.65;
    font-size: 10px;
  }

  .markdown { font-size: 14px; line-height: 1.6; }
  .markdown :global(h1) { font-size: 1.4em; margin: 0.8em 0 0.4em; }
  .markdown :global(h2) { font-size: 1.2em; margin: 0.8em 0 0.3em; }
  .markdown :global(h3) { font-size: 1.05em; margin: 0.6em 0 0.2em; }
  .markdown :global(p) { margin-bottom: 0.6em; }
  .markdown :global(ul), .markdown :global(ol) { margin: 0.4em 0 0.6em 1.2em; }
  .markdown :global(code) { background: var(--bg-3); padding: 0.1em 0.4em; border-radius: 3px; font-size: 0.88em; }
  .markdown :global(pre) { background: var(--bg-3); padding: 10px 14px; border-radius: 6px; overflow-x: auto; margin: 0.5em 0; }
  .markdown :global(pre code) { background: none; padding: 0; }
  .markdown :global(blockquote) { border-left: 3px solid var(--border); padding-left: 10px; color: var(--text-2); margin: 0.5em 0; }
  .markdown :global(a) { color: var(--accent); }
  .markdown :global(table) { border-collapse: collapse; width: 100%; margin: 0.5em 0; font-size: 13px; }
  .markdown :global(th), .markdown :global(td) { border: 1px solid var(--border); padding: 4px 8px; }
  .markdown :global(th) { background: var(--bg-3); }
  .markdown :global(.date-link), .markdown :global(.wiki-link) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-style: dotted;
    cursor: pointer;
    font: inherit;
    font-size: inherit;
    padding: 0;
    background: none;
    border: none;
  }
  .markdown :global(.date-link:hover), .markdown :global(.wiki-link:hover) { text-decoration-style: solid; }

  .cursor { animation: blink 1s infinite; color: var(--accent); }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  .referenced-files { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
  .referenced-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    margin-bottom: 6px;
  }
  .referenced-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .referenced-item {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .referenced-item:hover { border-color: var(--accent); background: var(--accent-dim); }
  .referenced-item:hover :global(.wfn-name) { color: var(--accent); }
  .referenced-item:hover :global(.wfn-folder) { color: var(--accent); opacity: 0.7; }

  .date-popover {
    position: fixed;
    z-index: 100;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    min-width: 240px;
    max-width: 320px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .date-popover-header {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 8px;
  }
</style>
