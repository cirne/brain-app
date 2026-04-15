<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte'
  import { type SurfaceContext } from '../router.js'
  import { buildChatBody, extractMentionedFiles, type ChatMessage, type ToolPart } from './agentUtils.js'
  import { contextPlaceholder } from './agentUtils.js'
  import { emit } from './app/appEvents.js'
  import { MessageSquarePlus } from 'lucide-svelte'
  import AgentConversation from './agent-conversation/AgentConversation.svelte'
  import AgentInput from './AgentInput.svelte'
  import WikiFileName from './WikiFileName.svelte'
  import PaneL2Header from './PaneL2Header.svelte'
  import type { AgentOpenSource } from './navigateFromAgentOpen.js'

  let {
    context = { type: 'none' } as SurfaceContext,
    conversationHidden = false,
    /** When true, `write` / `edit` do not auto-open the wiki pane (mobile: only explicit `open` opens UI). */
    suppressAgentWikiAutoOpen = false,
    onOpenWiki,
    onOpenEmail,
    onOpenFullInbox,
    onOpenImessage,
    onSwitchToCalendar,
    onOpenFromAgent,
    onNewChat,
    /** Fired when the user submits a chat message (before the request runs). */
    onUserSendMessage,
    /** Active session id changed (new chat, load, or SSE session event). */
    onSessionChange,
    /** After a send() stream finishes (success, error, or abort). */
    onChatPersisted,
    /** Live `write` tool body — wiki detail pane only. */
    onWriteStreaming,
    /** Live `edit` tool — wiki pane “Editing…” until tool_end. */
    onEditStreaming,
    mobileDetail,
    /** POST target for SSE (default main chat). */
    chatEndpoint = '/api/chat',
    /** Title until `set_chat_title` runs. */
    headerFallbackTitle = 'Chat',
    /** If set, sent as the first user message after mount (e.g. onboarding kickoff). */
    autoSendMessage = null as string | null,
    /** Called once when the server emits a terminal `done` event for the stream. */
    onStreamFinished,
    /** Persist transcript under this localStorage key; empty = no persistence. */
    storageKey = 'brain-agent',
    showNewChatButton = true,
  }: {
    context?: SurfaceContext
    conversationHidden?: boolean
    suppressAgentWikiAutoOpen?: boolean
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onOpenImessage?: (_canonicalChat: string, _displayLabel: string) => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    /** LLM `open` / `read_email` — fired from SSE tool_start */
    onOpenFromAgent?: (
      _target: { type: string; path?: string; id?: string; date?: string },
      _source: AgentOpenSource,
    ) => void
    onNewChat?: () => void
    onUserSendMessage?: () => void
    onSessionChange?: (_sessionId: string | null) => void
    onChatPersisted?: () => void
    onWriteStreaming?: (_p: { path: string; content: string; done: boolean }) => void
    onEditStreaming?: (_p: { id: string; path: string; done: boolean }) => void
    /** Full-screen detail stack above input (mobile only) */
    mobileDetail?: Snippet
    chatEndpoint?: string
    headerFallbackTitle?: string
    autoSendMessage?: string | null
    onStreamFinished?: () => void | Promise<void>
    storageKey?: string
    showNewChatButton?: boolean
  } = $props()

  function loadState(): { messages: ChatMessage[]; sessionId: string | null; chatTitle?: string | null } {
    if (!storageKey) return { messages: [], sessionId: null, chatTitle: null }
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return { messages: [], sessionId: null, chatTitle: null }
  }

  const initial = loadState()
  let messages = $state<ChatMessage[]>(initial.messages)
  let sessionId = $state<string | null>(initial.sessionId)
  let chatTitle = $state<string | null>(initial.chatTitle ?? null)
  let streaming = $state(false)
  let wikiFiles = $state<string[]>([])
  let conversationEl = $state<ReturnType<typeof AgentConversation> | undefined>(undefined)
  let inputEl = $state<ReturnType<typeof AgentInput> | undefined>(undefined)
  let abortController: AbortController | null = null

  async function focusAgentTextarea(delayMs: number) {
    await tick()
    if (delayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, delayMs))
    }
    inputEl?.focus()
  }

  $effect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ messages, sessionId, chatTitle }))
    } catch { /* ignore */ }
  })

  $effect(() => { fetchWikiFiles() })

  $effect(() => {
    onSessionChange?.(sessionId)
  })

  async function fetchWikiFiles() {
    try {
      const res = await fetch('/api/wiki')
      const files = await res.json()
      wikiFiles = files.map((f: { path: string }) => f.path)
    } catch { /* ignore */ }
  }

  onMount(() => {
    const m = autoSendMessage?.trim()
    if (m) void tick().then(() => send(m))
  })

  export function newChat() {
    messages = []
    sessionId = null
    chatTitle = null
    onNewChat?.()
    void focusAgentTextarea(0)
  }

  export async function newChatWithMessage(text: string) {
    messages = []
    sessionId = null
    chatTitle = null
    onNewChat?.()
    await tick()
    await send(text)
  }

  export async function loadSession(loadId: string) {
    try {
      const res = await fetch(`/api/chat/sessions/${encodeURIComponent(loadId)}`)
      if (!res.ok) {
        messages = [
          {
            role: 'assistant',
            content: `Could not load chat (${res.status}).`,
          },
        ]
        sessionId = null
        chatTitle = null
        await tick()
        conversationEl?.scrollToBottom()
        return
      }
      const doc = (await res.json()) as {
        sessionId?: string
        title?: string | null
        messages?: ChatMessage[]
      }
      const list = Array.isArray(doc.messages) ? doc.messages : []
      messages = list
      sessionId = typeof doc.sessionId === 'string' ? doc.sessionId : loadId
      chatTitle = doc.title ?? null
      await tick()
      conversationEl?.scrollToBottom()
      void focusAgentTextarea(0)
    } catch {
      messages = [{ role: 'assistant', content: 'Could not load chat.' }]
      sessionId = null
      chatTitle = null
      await tick()
      conversationEl?.scrollToBottom()
    }
  }

  function stopChat() {
    abortController?.abort()
  }

  async function send(text: string) {
    if (!text || streaming) return

    let touchedWiki = false
    /** Fire `open` / `read_email` side effects once per tool call id. */
    const openedFromAgentByToolId = new Set<string>()
    /** Open wiki once per write tool call when path first appears. */
    const writeOpenedWikiForToolId = new Set<string>()
    /** Open wiki once per edit tool call when path first appears. */
    const editOpenedWikiForToolId = new Set<string>()
    /** Preserve path and content for tool_end (referenced files) — write SSE has no args on tool_end. */
    const writePathByToolId = new Map<string, string>()
    const writeContentByToolId = new Map<string, string>()
    /** tool_start args (read, grep, …) — server now echoes args on tool_end; stash if missing. */
    const toolArgsByToolId = new Map<string, Record<string, unknown>>()
    const mentionedFiles = extractMentionedFiles(text)
    const isFirstMessage = messages.length === 0

    messages = [...messages, { role: 'user', content: text }]
    streaming = true

    const body = buildChatBody({ message: text, sessionId, context, mentionedFiles, isFirstMessage })

    // After context is serialized into the request (e.g. email thread), parent may clear overlay.
    onUserSendMessage?.()

    messages.push({ role: 'assistant', content: '', parts: [] })
    const msgIdx = messages.length - 1

    abortController = new AbortController()
    let sawDone = false

    try {
      const res = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
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
        buffer = lines.pop()!

        for (const line of lines) {
          if (line.startsWith('event: ')) { lastEvent = line.slice(7).trim(); continue }
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
                conversationEl?.scrollToBottom()
                break
              }
              case 'thinking':
                msg.thinking = (msg.thinking ?? '') + data.delta
                break
              case 'tool_args': {
                // Server emits for `write` / `edit` — stream to wiki pane without mutating chat tool rows.
                if (data.name === 'write') {
                  const path = typeof data.args?.path === 'string' ? data.args.path : ''
                  const content = typeof data.args?.content === 'string' ? data.args.content : ''
                  if (path) writePathByToolId.set(data.id, path)
                  if (content) writeContentByToolId.set(data.id, content)
                  if (path && !writeOpenedWikiForToolId.has(data.id)) {
                    writeOpenedWikiForToolId.add(data.id)
                    if (!suppressAgentWikiAutoOpen) onOpenWiki?.(path)
                  }
                  onWriteStreaming?.({ path, content, done: false })
                } else if (data.name === 'edit') {
                  const path = typeof data.args?.path === 'string' ? data.args.path : ''
                  if (path && !editOpenedWikiForToolId.has(data.id)) {
                    editOpenedWikiForToolId.add(data.id)
                    if (!suppressAgentWikiAutoOpen) onOpenWiki?.(path)
                  }
                  if (path) onEditStreaming?.({ id: data.id, path, done: false })
                }
                break
              }
              case 'tool_start': {
                if (data.name === 'set_chat_title') {
                  const parts = msg.parts!
                  const existing = parts.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
                  if (existing) {
                    existing.toolCall.name = data.name
                    existing.toolCall.args = data.args
                  } else {
                    parts.push({ type: 'tool', toolCall: { id: data.id, name: data.name, args: data.args, done: false } })
                  }
                  if (typeof data.args?.title === 'string') {
                    const t = data.args.title.trim().slice(0, 120)
                    if (t) chatTitle = t
                  }
                  messages = [...messages]
                } else if (data.name !== 'write') {
                  if (data.args != null && typeof data.args === 'object') {
                    toolArgsByToolId.set(data.id, data.args as Record<string, unknown>)
                  }
                  // Defer non-write tools to tool_end (no "running" rows in chat).
                  if (data.name === 'open' && data.args?.target && onOpenFromAgent && !openedFromAgentByToolId.has(data.id)) {
                    openedFromAgentByToolId.add(data.id)
                    onOpenFromAgent(data.args.target, 'open')
                  }
                  if (data.name === 'read_email' && typeof data.args?.id === 'string' && onOpenFromAgent && !openedFromAgentByToolId.has(data.id)) {
                    openedFromAgentByToolId.add(data.id)
                    onOpenFromAgent({ type: 'email', id: data.args.id }, 'read_email')
                  }
                }
                // write: no chat row; live body goes through tool_args + wiki pane
                conversationEl?.scrollToBottom()
                break
              }
              case 'tool_end': {
                let part = msg.parts!.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
                const writePath = data.name === 'write' ? writePathByToolId.get(data.id) : undefined
                const writeContent = data.name === 'write' ? writeContentByToolId.get(data.id) : undefined
                const stashedArgs = toolArgsByToolId.get(data.id)
                toolArgsByToolId.delete(data.id)
                const endArgs =
                  data.args != null && typeof data.args === 'object'
                    ? data.args
                    : stashedArgs
                const resolvedArgs = writePath ? { path: writePath, content: writeContent } : endArgs ?? {}
                if (!part) {
                  part = {
                    type: 'tool',
                    toolCall: {
                      id: data.id,
                      name: data.name,
                      args: resolvedArgs,
                      result: data.result,
                      details: data.details,
                      isError: data.isError,
                      done: true,
                    },
                  }
                  msg.parts!.push(part)
                } else {
                  part.toolCall.result = data.result
                  if (data.details !== undefined) part.toolCall.details = data.details
                  part.toolCall.isError = data.isError
                  part.toolCall.done = true
                  if (writePath) part.toolCall.args = { path: writePath, content: writeContent }
                  else if (endArgs !== undefined) part.toolCall.args = endArgs
                }
                const name = part.toolCall.name
                if (name === 'write' || name === 'edit' || name === 'delete') touchedWiki = true
                if (name === 'write') {
                  writePathByToolId.delete(data.id)
                  writeContentByToolId.delete(data.id)
                  onWriteStreaming?.({ path: '', content: '', done: true })
                }
                if (name === 'edit') {
                  onEditStreaming?.({ id: data.id, path: '', done: true })
                }
                messages = [...messages]
                conversationEl?.scrollToBottom()
                break
              }
              case 'error':
                msg.parts!.push({ type: 'text', content: `\n\n**Error:** ${data.message}` })
                break
              case 'done':
                sawDone = true
                break
            }
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ''
      if (name !== 'AbortError') {
        messages[msgIdx].parts!.push({ type: 'text', content: `\n\n**Connection error:** ${errMsg}` })
      }
    } finally {
      abortController = null
      streaming = false
      conversationEl?.scrollToBottom()
      if (touchedWiki) emit({ type: 'wiki:mutated', source: 'agent' })
      onChatPersisted?.()
      if (sawDone) void onStreamFinished?.()
    }
  }

  const placeholder = $derived(contextPlaceholder(context))

  const contextChip = $derived.by((): string | null => {
    if (context.type === 'email') return `📧 ${context.subject}`
    if (context.type === 'calendar') return `📅 ${context.date}`
    if (context.type === 'inbox') return '📥 Inbox'
    if (context.type === 'messages') return `💬 ${context.displayLabel}`
    return null
  })

</script>

<div class="agent-drawer">
  <!-- Body is the overlay anchor: mobile detail covers header + conversation only, not the input -->
  <div class="drawer-body">
    <!-- Always in flex flow — prevents height jump when overlay opens/closes -->
    <div inert={conversationHidden || undefined}>
      <PaneL2Header>
        {#snippet center()}
          <div class="header-left">
            <span class="drawer-title" class:thinking={streaming} class:custom-title={!!chatTitle}>
              {streaming ? 'Thinking...' : (chatTitle ?? headerFallbackTitle)}
            </span>
            {#if context.type === 'wiki'}
              <span class="context-chip"><WikiFileName path={context.path} /></span>
            {:else if contextChip}
              <span class="context-chip">{contextChip}</span>
            {/if}
          </div>
        {/snippet}
        {#snippet right()}
          {#if showNewChatButton && messages.length > 0}
            <button class="new-btn" onclick={() => newChat()} title="New conversation (⌘N)">
              <MessageSquarePlus size={14} strokeWidth={2} aria-hidden="true" />
              <span>New</span>
            </button>
          {/if}
        {/snippet}
      </PaneL2Header>
    </div>

    <!-- Always mounted so it is visible behind the overlay during the slide-out animation -->
    <div class="mid" inert={conversationHidden || undefined}>
      <AgentConversation
        bind:this={conversationEl}
        {messages}
        {streaming}
        {onOpenWiki}
        {onOpenEmail}
        {onOpenFullInbox}
        {onOpenImessage}
        {onSwitchToCalendar}
      />
    </div>

    {#if conversationHidden && mobileDetail}
      <div class="mobile-detail-layer">
        {@render mobileDetail()}
      </div>
    {/if}
  </div>

  <!-- Sibling below drawer-body: stays outside the mobile slide-over so the user can keep typing or start a new chat -->
  <div class="input-shell">
    <AgentInput
      bind:this={inputEl}
      {placeholder}
      {streaming}
      disabled={streaming}
      {wikiFiles}
      onSend={send}
      onStop={stopChat}
    />
  </div>
</div>

<style>
  .agent-drawer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-2);
    min-height: 0;
  }

  .drawer-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .input-shell {
    flex-shrink: 0;
  }

  /* Same width as .conversation when chat is full-width (no detail split) */
  @media (min-width: 768px) {
    :global(.split:not(.has-detail)) .input-shell {
      max-width: var(--chat-column-max);
      margin-left: auto;
      margin-right: auto;
      width: 100%;
    }
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
  }

  .drawer-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }
  .drawer-title.custom-title {
    text-transform: none;
    letter-spacing: 0.02em;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-title.thinking {
    animation: pulse-thinking 1.5s ease-in-out infinite;
  }
  @keyframes pulse-thinking {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .context-chip {
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  .new-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-2);
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }
  .new-btn :global(svg) {
    flex-shrink: 0;
    opacity: 0.9;
  }
  .new-btn:hover { color: var(--text); background: var(--bg-3); }

  .mid {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .mobile-detail-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .mobile-detail-layer :global(.slide-over) {
    border-left: none;
  }
</style>
