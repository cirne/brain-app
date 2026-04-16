<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte'
  import { type SurfaceContext } from '../router.js'
  import { buildChatBody, extractMentionedFiles, type ChatMessage, type SkillMenuItem } from './agentUtils.js'
  import { contextPlaceholder } from './agentUtils.js'
  import { emit } from './app/appEvents.js'

  function notifyChatSessionsChanged() {
    emit({ type: 'chat:sessions-changed' })
  }
  import { consumeAgentChatStream } from './agentStream.js'
  import {
    createPendingSessionKey,
    emptySession,
    migratePendingToServer,
    sessionIsLiveStreaming,
    setSessionImmutable,
    touchSessionImmutable,
    type SessionState,
  } from './chatSessionStore.js'
  import { MessageSquarePlus } from 'lucide-svelte'
  import AgentConversation from './agent-conversation/AgentConversation.svelte'
  import AgentInput from './AgentInput.svelte'
  import WikiFileName from './WikiFileName.svelte'
  import PaneL2Header from './PaneL2Header.svelte'
  import type { AgentOpenSource } from './navigateFromAgentOpen.js'

  let {
    context = { type: 'none' } as SurfaceContext,
    conversationHidden = false,
    /** When true, agent tools do not auto-open the right detail panel (wiki from write/edit, `open`, `read_email`, …). */
    suppressAgentDetailAutoOpen = false,
    onOpenWiki,
    onOpenEmail,
    onOpenFullInbox,
    onOpenMessageThread,
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
    /** Fired when the active session streaming flag changes (request/response cycle). */
    onStreamingChange,
    /** Persist transcript under this localStorage key; empty = no persistence. */
    storageKey = 'brain-agent',
    showNewChatButton = true,
  }: {
    context?: SurfaceContext
    conversationHidden?: boolean
    suppressAgentDetailAutoOpen?: boolean
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
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
    onStreamingChange?: (_streaming: boolean) => void
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

  function initialSessionsAndDisplay(): { sessions: Map<string, SessionState>; displayed: string } {
    const map = new Map<string, SessionState>()
    if (initial.sessionId && initial.messages.length > 0) {
      map.set(initial.sessionId, {
        messages: initial.messages,
        streaming: false,
        abortController: null,
        sessionId: initial.sessionId,
        chatTitle: initial.chatTitle ?? null,
      })
      return { sessions: map, displayed: initial.sessionId }
    }
    if (initial.messages.length > 0) {
      const pk = createPendingSessionKey()
      map.set(pk, {
        messages: initial.messages,
        streaming: false,
        abortController: null,
        sessionId: null,
        chatTitle: initial.chatTitle ?? null,
      })
      return { sessions: map, displayed: pk }
    }
    const pk = createPendingSessionKey()
    map.set(pk, emptySession())
    return { sessions: map, displayed: pk }
  }

  const init = initialSessionsAndDisplay()
  let sessions = $state(init.sessions)
  let displayedSessionId = $state(init.displayed)

  const messages = $derived.by((): ChatMessage[] => {
    const id = displayedSessionId
    if (!id) return []
    return sessions.get(id)?.messages ?? []
  })

  const chatTitle = $derived.by((): string | null => {
    const id = displayedSessionId
    if (!id) return null
    return sessions.get(id)?.chatTitle ?? null
  })

  const streaming = $derived.by((): boolean => {
    const id = displayedSessionId
    if (!id) return false
    return sessions.get(id)?.streaming ?? false
  })

  $effect(() => {
    onStreamingChange?.(streaming)
  })

  let wikiFiles = $state<string[]>([])
  let skillsList = $state<SkillMenuItem[]>([])
  let conversationEl = $state<ReturnType<typeof AgentConversation> | undefined>(undefined)
  let inputEl = $state<ReturnType<typeof AgentInput> | undefined>(undefined)

  async function focusAgentTextarea(delayMs: number) {
    await tick()
    if (delayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, delayMs))
    }
    inputEl?.focus()
  }

  $effect(() => {
    if (!storageKey) return
    const id = displayedSessionId
    if (!id) return
    const st = sessions.get(id)
    if (!st) return
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          messages: st.messages,
          sessionId: st.sessionId,
          chatTitle: st.chatTitle,
        }),
      )
    } catch { /* ignore */ }
  })

  $effect(() => {
    void fetchWikiFiles()
    void fetchSkills()
  })

  async function fetchSkills() {
    try {
      const res = await fetch('/api/skills')
      if (!res.ok) return
      const data: unknown = await res.json()
      if (!Array.isArray(data)) return
      skillsList = data as SkillMenuItem[]
    } catch {
      /* ignore */
    }
  }

  $effect(() => {
    const id = displayedSessionId
    if (!id) {
      onSessionChange?.(null)
      return
    }
    const sid = sessions.get(id)?.sessionId ?? null
    onSessionChange?.(sid)
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
    const pk = createPendingSessionKey()
    sessions = setSessionImmutable(sessions, pk, emptySession())
    displayedSessionId = pk
    onNewChat?.()
    void focusAgentTextarea(0)
  }

  export async function newChatWithMessage(text: string) {
    newChat()
    await tick()
    await send(text)
  }

  export async function loadSession(loadId: string) {
    if (sessionIsLiveStreaming(sessions, loadId)) {
      displayedSessionId = loadId
      await tick()
      conversationEl?.scrollToBottom()
      return
    }

    try {
      const res = await fetch(`/api/chat/sessions/${encodeURIComponent(loadId)}`)
      if (!res.ok) {
        const err = emptySession()
        err.messages = [
          {
            role: 'assistant',
            content: `Could not load chat (${res.status}).`,
          },
        ]
        sessions = setSessionImmutable(sessions, loadId, {
          ...err,
          sessionId: null,
          chatTitle: null,
        })
        displayedSessionId = loadId
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
      const sid = typeof doc.sessionId === 'string' ? doc.sessionId : loadId
      sessions = setSessionImmutable(sessions, sid, {
        messages: list,
        streaming: false,
        abortController: null,
        sessionId: sid,
        chatTitle: doc.title ?? null,
      })
      displayedSessionId = sid
      await tick()
      conversationEl?.scrollToBottom()
      void focusAgentTextarea(0)
    } catch {
      const pk = createPendingSessionKey()
      sessions = setSessionImmutable(sessions, pk, {
        messages: [{ role: 'assistant', content: 'Could not load chat.' }],
        streaming: false,
        abortController: null,
        sessionId: null,
        chatTitle: null,
      })
      displayedSessionId = pk
      await tick()
      conversationEl?.scrollToBottom()
    }
  }

  function stopChat() {
    const id = displayedSessionId
    if (!id) return
    sessions.get(id)?.abortController?.abort()
  }

  async function send(text: string) {
    const id = displayedSessionId
    if (!text || !id) return
    const st = sessions.get(id)
    if (!st || st.streaming) return

    const streamKey = id
    let activeKey = streamKey
    const mentionedFiles = extractMentionedFiles(text)
    const isFirstMessage = st.messages.length === 0

    const nextMessages = [...st.messages, { role: 'user', content: text }]
    nextMessages.push({ role: 'assistant', content: '', parts: [] })
    const msgIdx = nextMessages.length - 1

    const ac = new AbortController()
    sessions = touchSessionImmutable(sessions, id, {
      messages: nextMessages,
      streaming: true,
      abortController: ac,
    })

    const body = buildChatBody({
      message: text,
      sessionId: st.sessionId,
      context,
      mentionedFiles,
      isFirstMessage,
    })

    onUserSendMessage?.()

    let sawDone = false
    let touchedWiki = false

    try {
      const res = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      })

      if (!res.ok) {
        const row = sessions.get(activeKey)!.messages[msgIdx]
        if (!row.parts) row.parts = []
        row.parts.push({ type: 'text', content: `Error: ${res.status} ${res.statusText}` })
        sessions = touchSessionImmutable(sessions, activeKey, { streaming: false, abortController: null })
        return
      }

      const result = await consumeAgentChatStream(res, {
        getMessages: () => sessions.get(activeKey)!.messages,
        msgIdx,
        suppressAgentDetailAutoOpen,
        isActiveSession: () => displayedSessionId === activeKey,
        onOpenWiki,
        onWriteStreaming,
        onEditStreaming,
        onOpenFromAgent,
        setSessionId: (sid) => {
          if (!sid) return
          if (activeKey.startsWith('pending:')) {
            const r = migratePendingToServer(sessions, activeKey, sid, displayedSessionId)
            sessions = r.sessions
            displayedSessionId = r.displayedSessionId
            activeKey = sid
          } else {
            sessions = touchSessionImmutable(sessions, activeKey, { sessionId: sid })
          }
          notifyChatSessionsChanged()
        },
        setChatTitle: (t) => {
          sessions = touchSessionImmutable(sessions, activeKey, { chatTitle: t })
          notifyChatSessionsChanged()
        },
        touchMessages: () => {
          const cur = sessions.get(activeKey)
          if (!cur) return
          const next = [...cur.messages]
          const m = next[msgIdx]
          if (m?.role === 'assistant') {
            next[msgIdx] = {
              ...m,
              parts: m.parts
                ? m.parts.map((p) =>
                    p.type === 'text'
                      ? { type: 'text', content: p.content }
                      : { type: 'tool', toolCall: { ...p.toolCall } },
                  )
                : [],
            }
          }
          sessions = touchSessionImmutable(sessions, activeKey, { messages: next })
        },
        scrollToBottom: () => conversationEl?.scrollToBottom(),
      })
      touchedWiki = result.touchedWiki
      sawDone = result.sawDone
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ''
      if (name !== 'AbortError') {
        const row = sessions.get(activeKey)?.messages[msgIdx]
        if (row) {
          if (!row.parts) row.parts = []
          row.parts.push({ type: 'text', content: `\n\n**Connection error:** ${errMsg}` })
        }
      }
    } finally {
      sessions = touchSessionImmutable(sessions, activeKey, { abortController: null, streaming: false })
      conversationEl?.scrollToBottom()
      if (touchedWiki) emit({ type: 'wiki:mutated', source: 'agent' })
      notifyChatSessionsChanged()
      onChatPersisted?.()
      if (sawDone && displayedSessionId === activeKey) void onStreamFinished?.()
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
        {onOpenMessageThread}
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
      skills={skillsList}
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
