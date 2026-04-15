<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte'
  import { type SurfaceContext } from '../router.js'
  import { buildChatBody, extractMentionedFiles, type ChatMessage } from './agentUtils.js'
  import { contextPlaceholder } from './agentUtils.js'
  import { emit } from './app/appEvents.js'
  import { consumeAgentChatStream } from './agentStream.js'
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

    const mentionedFiles = extractMentionedFiles(text)
    const isFirstMessage = messages.length === 0

    messages = [...messages, { role: 'user', content: text }]
    streaming = true

    const body = buildChatBody({ message: text, sessionId, context, mentionedFiles, isFirstMessage })

    onUserSendMessage?.()

    messages.push({ role: 'assistant', content: '', parts: [] })
    const msgIdx = messages.length - 1

    abortController = new AbortController()
    let sawDone = false
    let touchedWiki = false

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

      const result = await consumeAgentChatStream(res, {
        messages,
        msgIdx,
        suppressAgentWikiAutoOpen,
        onOpenWiki,
        onWriteStreaming,
        onEditStreaming,
        onOpenFromAgent,
        setSessionId: (id) => { sessionId = id },
        setChatTitle: (t) => { chatTitle = t },
        touchMessages: () => { messages = [...messages] },
        scrollToBottom: () => conversationEl?.scrollToBottom(),
      })
      touchedWiki = result.touchedWiki
      sawDone = result.sawDone
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

<div class="agent-chat">
  <!-- Body is the overlay anchor: mobile detail covers header + conversation only, not the input -->
  <div class="chat-body">
    <!-- Always in flex flow — prevents height jump when overlay opens/closes -->
    <div inert={conversationHidden || undefined}>
      <PaneL2Header>
        {#snippet center()}
          <div class="header-left">
            <span class="chat-title" class:thinking={streaming} class:custom-title={!!chatTitle}>
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

  <!-- Sibling below chat-body: stays outside the mobile slide-over so the user can keep typing or start a new chat -->
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
  .agent-chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-2);
    min-height: 0;
  }

  .chat-body {
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

  .chat-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }
  .chat-title.custom-title {
    text-transform: none;
    letter-spacing: 0.02em;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-title.thinking {
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
