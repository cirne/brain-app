<script lang="ts">
  import { marked } from 'marked'
  import { onMount } from 'svelte'
  import DayEvents from './DayEvents.svelte'

  type ToolCall = {
    id: string
    name: string
    args: any
    result?: string
    isError?: boolean
    done: boolean
  }

  type TextPart = { type: 'text'; content: string }
  type ToolPart = { type: 'tool'; toolCall: ToolCall }
  type MessagePart = TextPart | ToolPart

  type ChatMessage = {
    role: 'user' | 'assistant'
    content: string  // kept for user messages
    parts?: MessagePart[]
    thinking?: string
  }

  // Props for file-grounded chat
  let {
    contextFiles = [],
    initialMessage,
    onSwitchToWiki,
  }: {
    contextFiles?: string[]
    initialMessage?: string
    onSwitchToWiki?: (_path: string) => void
  } = $props()

  let messages = $state<ChatMessage[]>([])
  let input = $state('')
  let streaming = $state(false)
  let sessionId = $state<string | null>(null)
  let messagesEl: HTMLElement
  let inputEl: HTMLTextAreaElement
  let datePopover = $state<{ date: string; x: number; y: number } | null>(null)

  // @mention autocomplete
  let wikiFiles = $state<string[]>([])
  let showMentions = $state(false)
  let mentionFilter = $state('')
  let mentionStart = $state(-1)
  let selectedMention = $state(0)

  $effect(() => {
    fetchWikiFiles()
  })

  onMount(() => {
    if (initialMessage) {
      input = initialMessage
      send()
    }
  })

  async function fetchWikiFiles() {
    try {
      const res = await fetch('/api/wiki')
      const files = await res.json()
      wikiFiles = files.map((f: any) => f.path)
    } catch { /* ignore */ }
  }

  function filteredMentions(): string[] {
    if (!mentionFilter) return wikiFiles.slice(0, 10)
    const q = mentionFilter.toLowerCase()
    return wikiFiles.filter(f => f.toLowerCase().includes(q)).slice(0, 10)
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement
    input = target.value
    autoResize(target)

    // Check for @mention trigger
    const pos = target.selectionStart
    const before = input.slice(0, pos)
    const atIndex = before.lastIndexOf('@')

    if (atIndex >= 0 && (atIndex === 0 || before[atIndex - 1] === ' ' || before[atIndex - 1] === '\n')) {
      const query = before.slice(atIndex + 1)
      if (!query.includes(' ') && !query.includes('\n')) {
        mentionStart = atIndex
        mentionFilter = query
        showMentions = true
        selectedMention = 0
        return
      }
    }
    showMentions = false
  }

  function insertMention(path: string) {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + mentionFilter.length + 1)
    input = `${before}@${path} ${after}`
    showMentions = false
    inputEl?.focus()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (showMentions) {
      const items = filteredMentions()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectedMention = Math.min(selectedMention + 1, items.length - 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectedMention = Math.max(selectedMention - 1, 0)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (items[selectedMention]) insertMention(items[selectedMention])
        return
      }
      if (e.key === 'Escape') {
        showMentions = false
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight
    })
  }

  async function send() {
    const text = input.trim()
    if (!text || streaming) return

    // Extract @mentioned files from the message
    const mentionedFiles = [...text.matchAll(/@([\w/.-]+\.md)/g)].map(m => m[1])
    const allContextFiles = [...new Set([...contextFiles, ...mentionedFiles])]

    // Add user message
    messages = [...messages, { role: 'user', content: text }]
    input = ''
    if (inputEl) {
      inputEl.style.height = 'auto'
    }
    streaming = true
    scrollToBottom()

    // Build request body
    const body: any = { message: text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
    if (sessionId) body.sessionId = sessionId
    if (allContextFiles.length && messages.length === 1) {
      // Only send context files on first message of a session
      body.context = { files: allContextFiles }
    }

    // Start streaming — push to $state array so Svelte 5 proxies the object
    messages.push({ role: 'assistant', content: '', parts: [] })
    const msgIdx = messages.length - 1

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        messages[msgIdx].parts!.push({ type: 'text', content: `Error: ${res.status} ${res.statusText}` })
        streaming = false
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let lastEvent = 'message'

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()! // Keep incomplete last line

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            lastEvent = line.slice(7).trim()
            continue
          }
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6))
            const msg = messages[msgIdx]

            switch (lastEvent) {
              case 'session':
                sessionId = data.sessionId
                break
              case 'text_delta': {
                const parts = msg.parts!
                const last = parts[parts.length - 1]
                if (last?.type === 'text') {
                  last.content += data.delta
                } else {
                  parts.push({ type: 'text', content: data.delta })
                }
                scrollToBottom()
                break
              }
              case 'thinking':
                msg.thinking = (msg.thinking ?? '') + data.delta
                break
              case 'tool_start':
                msg.parts!.push({ type: 'tool', toolCall: { id: data.id, name: data.name, args: data.args, done: false } })
                scrollToBottom()
                break
              case 'tool_end': {
                const part = msg.parts!.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
                if (part) {
                  part.toolCall.result = data.result
                  part.toolCall.isError = data.isError
                  part.toolCall.done = true
                  scrollToBottom()
                }
                break
              }
              case 'error':
                msg.parts!.push({ type: 'text', content: `\n\n**Error:** ${data.message}` })
                break
              case 'done':
                break
            }
          }
        }
      }
    } catch (err: any) {
      messages[msgIdx].parts!.push({ type: 'text', content: `\n\n**Connection error:** ${err.message}` })
    } finally {
      streaming = false
      scrollToBottom()
    }
  }

  function newChat() {
    messages = []
    sessionId = null
    input = ''
    contextFiles = []
  }

  // ISO date regex: YYYY-MM-DD not inside an HTML tag attribute
  const ISO_DATE_RE = /\b(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b(?![^<>]*>)/g

  function renderMarkdown(text: string): string {
    try {
      const html = marked(text) as string
      // Wrap ISO dates in clickable buttons
      return html.replace(ISO_DATE_RE, '<button class="date-link" data-date="$1">$1</button>')
    } catch {
      return text
    }
  }

  function handleMessagesClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    const btn = target.closest<HTMLElement>('[data-date]')
    if (!btn) {
      datePopover = null
      return
    }
    const date = btn.dataset.date!
    const rect = btn.getBoundingClientRect()
    // Position below the button, clamped to viewport width
    const x = Math.min(rect.left, window.innerWidth - 260)
    const y = rect.bottom + 6
    datePopover = { date, x, y }
    e.stopPropagation()
  }

  function closeDatePopover() { datePopover = null }

  function formatArgs(args: any): string {
    if (!args) return ''
    try {
      return JSON.stringify(args, null, 2)
    } catch {
      return String(args)
    }
  }
</script>

<div class="chat">
  <header class="chat-header">
    <span class="title">
      {#if contextFiles.length}
        Chatting about <button class="context-link" onclick={() => onSwitchToWiki?.(contextFiles[0])}>{contextFiles[0]}</button>
      {:else}
        Chat
      {/if}
    </span>
    <button class="new-chat-btn" onclick={newChat}>New Chat</button>
  </header>

  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  <div class="messages" bind:this={messagesEl} onclick={handleMessagesClick}>
    {#if messages.length === 0}
      <div class="empty-state">
        <p>Ask anything about your wiki or email.</p>
        <p class="hint">Use <kbd>@</kbd> to reference wiki files.</p>
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
            {#if part.type === 'tool'}
              <details class="tool-call" class:error={part.toolCall.isError} open={!part.toolCall.done}>
                <summary>
                  <span class="tool-icon">{part.toolCall.done ? (part.toolCall.isError ? '!' : '') : '...'}</span>
                  <span class="tool-name">{part.toolCall.name}</span>
                  {#if !part.toolCall.done}
                    <span class="tool-status">running</span>
                  {/if}
                </summary>
                {#if part.toolCall.args}
                  <pre class="tool-args">{formatArgs(part.toolCall.args)}</pre>
                {/if}
                {#if part.toolCall.result}
                  <pre class="tool-result" class:tool-error={part.toolCall.isError}>{part.toolCall.result}</pre>
                {/if}
              </details>
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
  </div>

  {#if datePopover}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <div class="date-popover-backdrop" onclick={closeDatePopover}></div>
    <div class="date-popover" style="left:{datePopover.x}px;top:{datePopover.y}px">
      <div class="date-popover-header">
        {new Date(datePopover.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
      <DayEvents date={datePopover.date} />
    </div>
  {/if}

  <div class="input-area">
    {#if showMentions}
      <div class="mention-dropdown">
        {#each filteredMentions() as file, i}
          <button
            class="mention-item"
            class:selected={i === selectedMention}
            onmousedown={(e) => { e.preventDefault(); insertMention(file) }}
          >
            {file}
          </button>
        {:else}
          <div class="mention-empty">No matching files</div>
        {/each}
      </div>
    {/if}

    <div class="input-row">
      <textarea
        bind:this={inputEl}
        bind:value={input}
        oninput={handleInput}
        onkeydown={handleKeydown}
        placeholder="Ask anything... (@ to mention files)"
        rows="1"
        disabled={streaming}
      ></textarea>
      <button class="send-btn" onclick={send} disabled={streaming || !input.trim()}>
        {streaming ? '...' : 'Send'}
      </button>
    </div>
  </div>
</div>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .chat-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
  }

  .context-link {
    color: var(--accent);
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    text-decoration: underline;
    cursor: pointer;
  }

  .new-chat-btn {
    font-size: 12px;
    color: var(--accent);
    padding: 4px 10px;
    border: 1px solid var(--accent-dim);
    border-radius: 4px;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-2);
    font-size: 14px;
    gap: 8px;
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

  .tool-call {
    margin: 8px 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    overflow: hidden;
  }

  .tool-call summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    cursor: pointer;
    background: var(--bg-2);
    user-select: none;
  }

  .tool-icon {
    font-size: 12px;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  .tool-call:not(.error) .tool-icon { color: var(--success); }
  .tool-call.error .tool-icon { color: var(--danger); }

  .tool-name {
    font-family: monospace;
    font-size: 12px;
    color: var(--accent);
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

  .tool-error {
    color: var(--danger);
  }

  .markdown {
    font-size: 14px;
    line-height: 1.6;
  }

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

  .cursor {
    animation: blink 1s infinite;
    color: var(--accent);
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  .input-area {
    position: relative;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .mention-dropdown {
    position: absolute;
    bottom: 100%;
    left: 16px;
    right: 16px;
    max-height: 200px;
    overflow-y: auto;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 4px;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
  }

  .mention-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--text);
    font-family: monospace;
  }

  .mention-item:hover, .mention-item.selected {
    background: var(--accent-dim);
    color: var(--accent);
  }

  .mention-empty {
    padding: 8px 12px;
    font-size: 12px;
    color: var(--text-2);
  }

  .input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }

  .input-row textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    font: inherit;
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
    line-height: 1.4;
    min-height: 40px;
    max-height: 200px;
  }

  .input-row textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .input-row textarea:disabled {
    opacity: 0.6;
  }

  .send-btn {
    height: 40px;
    padding: 0 16px;
    border-radius: 8px;
    background: var(--accent);
    color: white;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Date links injected into rendered markdown */
  .markdown :global(.date-link) {
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

  .markdown :global(.date-link:hover) {
    text-decoration-style: solid;
  }

  .date-popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .date-popover {
    position: fixed;
    z-index: 100;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    min-width: 240px;
    max-width: 320px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
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
