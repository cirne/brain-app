<script lang="ts">
  import { onMount, tick, type Component, type Snippet } from 'svelte'
  import { type SurfaceContext } from '@client/router.js'
  import type { AgentConversationViewProps, ConversationScrollApi } from '@client/lib/agentConversationViewTypes.js'
  import type { ContentCardPreview } from '@client/lib/cards/contentCards.js'
  import {
    buildChatBody,
    contextPlaceholder,
    extractMentionedFiles,
    extractReferencedFiles,
    sumAssistantUsageTotalTokens,
    type ChatMessage,
    type SkillMenuItem,
  } from '@client/lib/agentUtils.js'
  import { extractLatestSuggestReplyChoices } from '@client/lib/tools/suggestReplyChoices.js'
  import { emit, subscribe as subscribeAppEvents } from '@client/lib/app/appEvents.js'
  import { ensureBrainTtsAutoplayInUserGesture } from '@client/lib/brainTtsAudio.js'
  import { readChatToolDisplayPreference } from '@client/lib/chatToolDisplayPreference.js'
  import { readHearRepliesPreference, writeHearRepliesPreference } from '@client/lib/hearRepliesPreference.js'
  import { registerWikiFileListRefetch } from '@client/lib/wikiFileListRefetch.js'

  function notifyChatSessionsChanged() {
    emit({ type: 'chat:sessions-changed' })
  }
  import { consumeAgentChatStream } from '@client/lib/agentChat/streamClient.js'
  import {
    collectStreamingSessionIds,
    createPendingSessionKey,
    emptySession,
    migratePendingToServer,
    sessionIsLiveStreaming,
    setSessionImmutable,
    touchSessionImmutable,
    type SessionState,
  } from '@client/lib/chatSessionStore.js'
  import { shiftQueuedFollowUp } from '@client/lib/agentFollowUpQueue.js'
  import { Trash2, Volume2, VolumeX } from 'lucide-svelte'
  import AgentConversation from './agent-conversation/AgentConversation.svelte'
  import ComposerContextBar from './agent-conversation/ComposerContextBar.svelte'
  import { isPressToTalkEnabled } from '@client/lib/pressToTalkEnabled.js'
  import { applyVoiceTranscriptToChat } from '@client/lib/voiceTranscribeRouting.js'
  import UnifiedChatComposer from './UnifiedChatComposer.svelte'
  import WikiFileName from './WikiFileName.svelte'
  import PaneL2Header from './PaneL2Header.svelte'
  import ConversationTokenMeter from './ConversationTokenMeter.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import { labelForDeleteChatDialog } from '@client/lib/chatHistoryDelete.js'
  import type { AgentOpenSource } from '@client/lib/navigateFromAgentOpen.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  let {
    context = { type: 'none' } as SurfaceContext,
    conversationHidden = false,
    /** When true, agent tools do not auto-open the right detail panel (wiki from write/edit, `open`, `read_email`, **`draft_email`** overlay, …). */
    suppressAgentDetailAutoOpen = false,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onOpenMessageThread,
    onSwitchToCalendar,
    onOpenMailSearchResults,
    onOpenFromAgent,
    onOpenDraftFromAgent,
    onNewChat,
    onOpenWikiAbout,
    onAfterDeleteChat,
    /** Fired when the user submits a chat message (before the request runs). */
    onUserSendMessage,
    /**
     * Full “new chat” chrome flow (navigate, session reset, `chatIsEmpty`, …). Shown as + beside the
     * composer when the thread has messages. Main app: same handler as the top bar / sidebar.
     */
    onUserInitiatedNewChat = undefined as (() => void) | undefined,
    /**
     * When set (e.g. Hub “add folders” panel), `finish_conversation` calls this instead of
     * {@link onUserInitiatedNewChat} — typically close the overlay.
     */
    onConversationFinishedByAgent = undefined as (() => void) | undefined,
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
    /** All server session ids that currently have an in-flight stream (for nav “busy” state). */
    onStreamingSessionsChange,
    /** Persist transcript under this localStorage key; empty = no persistence. */
    storageKey: _storageKey = 'brain-agent',
    /**
     * Main transcript UI. Defaults to the standard chat. Pass a different component
     * (e.g. onboarding profiling, future “wiki cleanup” agents) with the same props +
     * {@link ConversationScrollApi} on the instance.
     */
    conversationView = AgentConversation as Component<AgentConversationViewProps>,
    /** Hide the composer (e.g. kickoff-only flows). */
    hideInput = false,
    /** When non-empty, header text while streaming; otherwise chat title or {@link headerFallbackTitle}. */
    streamingBusyLabel = '',
    /** Live `write` stream for onboarding profiling / seeding transcript (e.g. `me.md` preview). */
    streamingWritePreview = null as { path: string; body: string } | null,
    /**
     * When true, omit wiki/file/subject chips under the chat title — the desktop split detail
     * header already shows the same context.
     */
    hidePaneContextChip = false,
    /** When set, overrides {@link contextPlaceholder} for the composer hint. */
    inputPlaceholder = undefined as string | undefined,
    /** Hosted multi-tenant: profiling transcript uses alternate privacy lead copy. */
    multiTenant = false,
    /**
     * Mobile + slide-over: place the slide above the composer only (not full-bleed over it).
     * When false, the slide covers the full chat column (e.g. non-doc overlays with {@link hideInput}).
     */
    mobileSlideCoversTranscriptOnly = false,
    /**
     * When true with {@link autoSendMessage}, the first send uses no user bubble and sets
     * `interviewKickoff` on `POST /api/onboarding/interview` so the server prepends fresh `ripmail whoami`.
     */
    autoSendInterviewKickoffHidden = false,
  }: {
    context?: SurfaceContext
    conversationHidden?: boolean
    suppressAgentDetailAutoOpen?: boolean
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMailSearchResults?: (
      _preview: Extract<ContentCardPreview, { kind: 'mail_search_hits' }>,
      _sourceId: string,
    ) => void
    /** LLM `open` / `read_email` — fired from SSE tool_start */
    onOpenFromAgent?: (
      _target: { type: string; path?: string; id?: string; date?: string },
      _source: AgentOpenSource,
    ) => void
    /** SSE `draft_email` tool_end — desktop split opens draft overlay when set */
    onOpenDraftFromAgent?: (_draftId: string, _subject?: string) => void
    onNewChat?: () => void
    /** Empty-state “your wiki” link → wiki vault landing (same as Wiki in the top bar). */
    onOpenWikiAbout?: () => void
    /** After this chat is deleted (API + confirm); defaults to {@link newChat} with overlay skip. Main app passes the same handler as sidebar “New chat”. */
    onAfterDeleteChat?: () => void
    onUserSendMessage?: () => void
    /** Optional; when set, a “new chat” control is shown beside the composer (non-empty thread). */
    onUserInitiatedNewChat?: () => void
    onConversationFinishedByAgent?: () => void
    onSessionChange?: (
      _sessionId: string | null,
      _meta?: { chatTitle?: string | null },
    ) => void
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
    onStreamingSessionsChange?: (_sessionIds: ReadonlySet<string>) => void
    storageKey?: string
    conversationView?: Component<AgentConversationViewProps>
    hideInput?: boolean
    streamingBusyLabel?: string
    streamingWritePreview?: { path: string; body: string } | null
    hidePaneContextChip?: boolean
    inputPlaceholder?: string
    multiTenant?: boolean
    mobileSlideCoversTranscriptOnly?: boolean
    autoSendInterviewKickoffHidden?: boolean
  } = $props()

  /** Slide-over only over transcript; composer stays visible (mobile chat bridge). */
  const pressToTalkUiEnabled = isPressToTalkEnabled()

  const bridgeSlideLayout = $derived(
    conversationHidden && mobileSlideCoversTranscriptOnly && !!mobileDetail,
  )

  const voiceComposerEligible = $derived(pressToTalkUiEnabled)

  const showComposerNewChat = $derived(
    typeof onUserInitiatedNewChat === 'function' && messages.length > 0 && !hideInput,
  )

  /** Dynamic transcript component (default {@link AgentConversation}). */
  const ConversationView = $derived(conversationView)

  function loadState(): { messages: ChatMessage[]; sessionId: string | null; chatTitle?: string | null } {
    return { messages: [], sessionId: null, chatTitle: null }
  }

  const initial = loadState()

  function initialSessionsAndDisplay(): { sessions: Map<string, SessionState>; displayed: string } {
    const defaultHearReplies = readHearRepliesPreference()
    const map = new Map<string, SessionState>()
    if (initial.sessionId && initial.messages.length > 0) {
      map.set(initial.sessionId, {
        messages: initial.messages,
        streaming: false,
        abortController: null,
        sessionId: initial.sessionId,
        chatTitle: initial.chatTitle ?? null,
        pendingQueuedMessages: [],
        hearReplies: defaultHearReplies,
        composerResetKey: initial.sessionId,
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
        pendingQueuedMessages: [],
        hearReplies: defaultHearReplies,
        composerResetKey: pk,
      })
      return { sessions: map, displayed: pk }
    }
    const pk = createPendingSessionKey()
    map.set(pk, {
      ...emptySession(),
      hearReplies: defaultHearReplies,
      composerResetKey: pk,
    })
    return { sessions: map, displayed: pk }
  }

  const init = initialSessionsAndDisplay()
  let sessions = $state(init.sessions)
  let displayedSessionId = $state(init.displayed)
  let toolDisplayMode = $state(readChatToolDisplayPreference())

  const sessionLoadLatest = createAsyncLatest({ abortPrevious: true })

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

  const contextBarFiles = $derived(extractReferencedFiles(messages))
  const conversationTokenTotal = $derived(sumAssistantUsageTotalTokens(messages))
  const contextBarChoices = $derived(extractLatestSuggestReplyChoices(messages, streaming))
  const showComposerContextBar = $derived(
    contextBarFiles.length > 0 || contextBarChoices.length > 0,
  )

  /** Tracks the actual rendered height of the floating context bar for transcript padding. */
  let contextBarWrapEl = $state<HTMLDivElement | null>(null)
  let contextBarActualHeight = $state(0)

  $effect(() => {
    const el = contextBarWrapEl
    if (!el) {
      contextBarActualHeight = 0
      return
    }
    const ro = new ResizeObserver(() => {
      contextBarActualHeight = el.offsetHeight
    })
    ro.observe(el)
    contextBarActualHeight = el.offsetHeight
    return () => ro.disconnect()
  })

  /**
   * Session TTS output flag (POST `hearReplies`, assistant voice). Passed to the voice capture
   * layer for WebKit `audioSession` restore after dictation — not for gating the mic.
   * If the row is briefly missing during store updates, avoid passing `false` (optimistic `true`)
   * so we do not flash-gate or mis-signal the capture module during races.
   */
  const hearRepliesForChatComposer = $derived.by((): boolean => {
    const id = displayedSessionId
    if (id == null) {
      return false
    }
    const row = sessions.get(id)
    if (row == null) {
      return true
    }
    return row.hearReplies === true
  })

  /** Survives pending → server session id migration; keeps UnifiedChatComposer voice mode across SSE `session`. */
  const unifiedComposerSessionResetKey = $derived.by((): string => {
    const id = displayedSessionId
    if (!id) return ''
    const k = sessions.get(id)?.composerResetKey?.trim()
    return k ? k : id
  })

  $effect(() => {
    onStreamingChange?.(streaming)
  })

  let lastStreamingSessionsKey = ''

  function notifyStreamingSessionsChanged() {
    const ids = collectStreamingSessionIds(sessions)
    const key = [...ids].sort().join(',')
    if (key === lastStreamingSessionsKey) return
    lastStreamingSessionsKey = key
    onStreamingSessionsChange?.(ids)
  }

  let wikiFiles = $state<string[]>([])
  let skillsList = $state<SkillMenuItem[]>([])
  let conversationEl = $state<ConversationScrollApi | undefined>(undefined)
  let inputEl = $state<ReturnType<typeof UnifiedChatComposer> | undefined>(undefined)
  /** Current composer text for voice transcript routing (empty → send, draft → append). */
  let inputDraftForMobileHold = $state('')

  function onAgentInputDraftChange(d: string) {
    inputDraftForMobileHold = d
  }

  function onVoiceTranscribe(text: string) {
    applyVoiceTranscriptToChat(text, inputDraftForMobileHold, send, appendToComposer)
  }

  async function focusAgentTextarea(delayMs: number) {
    await tick()
    if (delayMs > 0) {
      await new Promise<void>((r) => setTimeout(r, delayMs))
    }
    inputEl?.focus()
  }

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
      onSessionChange?.(null, undefined)
      return
    }
    const row = sessions.get(id)
    const sid = row?.sessionId ?? null
    const chatTitle = row?.chatTitle ?? null
    onSessionChange?.(sid, { chatTitle })
  })

  async function fetchWikiFiles() {
    try {
      const res = await fetch('/api/wiki')
      if (!res.ok) return
      const data: unknown = await res.json()
      if (!Array.isArray(data)) return
      wikiFiles = data
        .map((f) =>
          f && typeof f === 'object' && 'path' in f && typeof (f as { path: unknown }).path === 'string'
            ? (f as { path: string }).path
            : null,
        )
        .filter((p): p is string => p != null)
    } catch { /* ignore */ }
  }

  onMount(() => {
    void fetchWikiFiles()
    void fetchSkills()
    const unsubWikiList = registerWikiFileListRefetch(fetchWikiFiles)
    const unsubPrefs = subscribeAppEvents((e) => {
      if (e.type === 'chat:tool-display-changed') {
        toolDisplayMode = e.mode
      }
    })
    const m = autoSendMessage?.trim()
    if (m) void tick().then(() => send(m, undefined, false, autoSendInterviewKickoffHidden))
    return () => {
      unsubWikiList()
      unsubPrefs()
    }
  })

  export function newChat(options?: { skipOverlayClose?: boolean }) {
    const pk = createPendingSessionKey()
    sessions = setSessionImmutable(sessions, pk, {
      ...emptySession(),
      hearReplies: readHearRepliesPreference(),
      composerResetKey: pk,
    })
    displayedSessionId = pk
    if (!options?.skipOverlayClose) onNewChat?.()
    void focusAgentTextarea(0)
  }

  export async function newChatWithMessage(
    text: string,
    options?: { skipOverlayClose?: boolean },
  ) {
    newChat(options)
    await tick()
    await send(text)
  }

  /** Persisted chat session id from the last SSE `session` event (onboarding finalize, etc.). */
  export function getBackendSessionId(): string | null {
    const id = displayedSessionId
    if (!id) return null
    return sessions.get(id)?.sessionId ?? null
  }

  /** Add text to the composer (e.g. @page.md) without sending. */
  export function appendToComposer(text: string) {
    inputEl?.appendText(text)
  }

  export function focusComposer() {
    void focusAgentTextarea(0)
  }

  export async function loadSession(loadId: string) {
    if (sessionIsLiveStreaming(sessions, loadId)) {
      displayedSessionId = loadId
      await tick()
      conversationEl?.scrollToBottom()
      return
    }

    const { token, signal } = sessionLoadLatest.begin()
    try {
      const res = await fetch(`/api/chat/sessions/${encodeURIComponent(loadId)}`, { signal })
      if (sessionLoadLatest.isStale(token)) {
        return
      }
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
          pendingQueuedMessages: [],
          hearReplies: readHearRepliesPreference(),
          composerResetKey: loadId,
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
      if (sessionLoadLatest.isStale(token)) {
        return
      }
      const list = Array.isArray(doc.messages) ? doc.messages : []
      const sid = typeof doc.sessionId === 'string' ? doc.sessionId : loadId
      sessions = setSessionImmutable(sessions, sid, {
        messages: list,
        streaming: false,
        abortController: null,
        sessionId: sid,
        chatTitle: doc.title ?? null,
        pendingQueuedMessages: [],
        hearReplies: readHearRepliesPreference(),
        composerResetKey: sid,
      })
      displayedSessionId = sid
      await tick()
      conversationEl?.scrollToBottom()
      void focusAgentTextarea(0)
    } catch (e) {
      if (sessionLoadLatest.isStale(token) || isAbortError(e)) return
      const pk = createPendingSessionKey()
      sessions = setSessionImmutable(sessions, pk, {
        messages: [{ role: 'assistant', content: 'Could not load chat.' }],
        streaming: false,
        abortController: null,
        sessionId: null,
        chatTitle: null,
        pendingQueuedMessages: [],
        hearReplies: readHearRepliesPreference(),
        composerResetKey: pk,
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

  /**
   * @param forSessionKey — when set (e.g. queued follow-up after a background stream ends), send targets this map key instead of the currently displayed session.
   * @param firstChatKickoff — post-onboarding: assistant speaks first (no user bubble); see POST /api/chat `firstChatKickoff`.
   * @param interviewKickoffHidden — guided onboarding: no user bubble; server prepends `ripmail whoami` to this message.
   */
  async function send(
    text: string,
    forSessionKey?: string,
    firstChatKickoff = false,
    interviewKickoffHidden = false,
  ) {
    const id = forSessionKey ?? displayedSessionId
    if ((!text?.trim() && !firstChatKickoff) || !id) return
    const st = sessions.get(id)
    if (!st) return

    if (st.streaming) {
      if (firstChatKickoff || interviewKickoffHidden) return
      const t = text.trim()
      if (!t) return
      const prev = st.pendingQueuedMessages ?? []
      sessions = touchSessionImmutable(sessions, id, { pendingQueuedMessages: [...prev, t] })
      return
    }

    const streamKey = id
    let activeKey = streamKey
    const mentionedFiles = firstChatKickoff || interviewKickoffHidden ? [] : extractMentionedFiles(text)
    const isFirstMessage = st.messages.length === 0

    const hideUserBubble = firstChatKickoff || interviewKickoffHidden
    const nextMessages = hideUserBubble
      ? [...st.messages, { role: 'assistant' as const, content: '', parts: [] }]
      : [...st.messages, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: '', parts: [] }]
    const msgIdx = nextMessages.length - 1

    if (st.hearReplies === true) {
      await ensureBrainTtsAutoplayInUserGesture()
    }

    const ac = new AbortController()
    sessions = touchSessionImmutable(sessions, id, {
      messages: nextMessages,
      streaming: true,
      abortController: ac,
    })
    notifyStreamingSessionsChanged()
    await tick()
    conversationEl?.scrollToBottom()

    const body = buildChatBody({
      message: text,
      sessionId: st.sessionId,
      context,
      mentionedFiles,
      isFirstMessage,
      firstChatKickoff,
      interviewKickoff: interviewKickoffHidden,
      hearReplies: st.hearReplies === true,
    })

    if (!hideUserBubble) onUserSendMessage?.()

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
        notifyStreamingSessionsChanged()
        return
      }

      const result = await consumeAgentChatStream(res, {
        getMessages: () => sessions.get(activeKey)!.messages,
        msgIdx,
        suppressAgentDetailAutoOpen,
        isActiveSession: () => displayedSessionId === activeKey,
        isHearRepliesEnabled: () => sessions.get(activeKey)?.hearReplies === true,
        onOpenWiki,
        onWriteStreaming,
        onEditStreaming,
        onOpenFromAgent,
        onOpenDraftFromAgent,
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
          notifyStreamingSessionsChanged()
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
        scrollToBottom: () => conversationEl?.scrollToBottomIfFollowing(),
        onFinishConversation: () => {
          if (onConversationFinishedByAgent) onConversationFinishedByAgent()
          else onUserInitiatedNewChat?.()
        },
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
      notifyStreamingSessionsChanged()
      conversationEl?.scrollToBottom()
      if (touchedWiki) emit({ type: 'wiki:mutated', source: 'agent' })
      notifyChatSessionsChanged()
      onChatPersisted?.()
      if (sawDone && displayedSessionId === activeKey) void onStreamFinished?.()

      const { next: queued, rest: queueRest } = shiftQueuedFollowUp(
        sessions.get(activeKey)?.pendingQueuedMessages,
      )
      if (queued) {
        sessions = touchSessionImmutable(sessions, activeKey, { pendingQueuedMessages: queueRest })
        void send(queued, activeKey)
      }
    }
  }

  /** First turn after onboarding when the server marked first-chat pending — assistant opens, no user message. */
  export async function sendFirstChatKickoff(forSessionKey?: string) {
    await send('', forSessionKey, true)
  }

  const placeholder = $derived(
    inputPlaceholder ?? contextPlaceholder(context, messages.length > 0),
  )

  const contextChip = $derived.by((): string | null => {
    if (context.type === 'email') return `📧 ${context.subject}`
    if (context.type === 'calendar') return `📅 ${context.date}`
    if (context.type === 'inbox') return '📥 Inbox'
    if (context.type === 'messages') return `💬 ${context.displayLabel}`
    return null
  })

  const pendingQueuedMessages = $derived.by((): string[] => {
    const id = displayedSessionId
    if (!id) return []
    return sessions.get(id)?.pendingQueuedMessages ?? []
  })

  /** When true, vertically center the empty transcript and (when shown) the composer. */
  const centerEmptyInPane = $derived(messages.length === 0)

  let pendingDelete = $state<{ serverId: string | null; label: string } | null>(null)

  function titleForDeleteDialog(): string {
    if (chatTitle?.trim()) return chatTitle.trim()
    for (const m of messages) {
      if (m.role === 'user' && m.content) {
        const t = typeof m.content === 'string' ? m.content.trim() : ''
        if (t) return t
      }
    }
    return headerFallbackTitle
  }

  function toggleHearRepliesFromHeader() {
    const id = displayedSessionId
    if (!id) return
    const cur = sessions.get(id)?.hearReplies ?? false
    if (cur === false) {
      void ensureBrainTtsAutoplayInUserGesture()
    }
    const next = !cur
    writeHearRepliesPreference(next)
    sessions = touchSessionImmutable(sessions, id, { hearReplies: next })
  }

  function requestDeleteCurrentChat() {
    if (messages.length === 0) return
    pendingDelete = {
      serverId: sessions.get(displayedSessionId)?.sessionId ?? null,
      label: labelForDeleteChatDialog(titleForDeleteDialog()),
    }
  }

  function cancelDeleteCurrentChat() {
    pendingDelete = null
  }

  async function confirmDeleteCurrentChat() {
    if (!pendingDelete) return
    stopChat()
    const { serverId } = pendingDelete
    try {
      if (serverId) {
        const res = await fetch(`/api/chat/${encodeURIComponent(serverId)}`, { method: 'DELETE' })
        if (!res.ok) return
      }
    } catch {
      return
    }
    pendingDelete = null
    notifyChatSessionsChanged()
    if (onAfterDeleteChat) {
      onAfterDeleteChat()
    } else {
      newChat({ skipOverlayClose: true })
    }
  }

</script>

<div class="agent-chat">
  <div
    class="chat-body"
    style:--composer-context-overlap-pad={showComposerContextBar && contextBarActualHeight > 0
      ? `${contextBarActualHeight}px`
      : '0'}
  >
    <div class="chat-top">
    {#if !centerEmptyInPane}
    <!-- Always in flex flow — prevents height jump when overlay opens/closes -->
    <div inert={conversationHidden || undefined}>
      <PaneL2Header>
        {#snippet center()}
          <div class="header-left">
            <span
              class="chat-title"
              class:custom-title={!!chatTitle}
              aria-label={streaming &&
              !(streamingBusyLabel ?? '').trim() &&
              !(chatTitle ?? '').trim()
                ? 'Assistant is working'
                : undefined}
            >
              {#if streaming}
                {#if (streamingBusyLabel ?? '').trim()}
                  {streamingBusyLabel}
                {:else}
                  {(chatTitle ?? '').trim() || headerFallbackTitle}
                {/if}
              {:else}
                {chatTitle ?? headerFallbackTitle}
              {/if}
            </span>
            {#if !hidePaneContextChip}
              {#if context.type === 'wiki'}
                <span class="context-chip"><WikiFileName path={context.path} /></span>
              {:else if context.type === 'file'}
                <span class="context-chip"><WikiFileName path={context.path} /></span>
              {:else if contextChip}
                <span class="context-chip">{contextChip}</span>
              {/if}
            {/if}
          </div>
        {/snippet}
        {#snippet right()}
          {@const hearRepliesOn = sessions.get(displayedSessionId)?.hearReplies === true}
          <div class="pane-header-actions">
            <ConversationTokenMeter totalTokens={conversationTokenTotal} />
            <button
              type="button"
              class="hear-replies-header-btn"
              class:hear-replies-header-btn--on={hearRepliesOn}
              aria-pressed={hearRepliesOn}
              title="Assistant speaks replies (text-to-speech)"
              aria-label={hearRepliesOn
                ? 'Assistant voice output on'
                : 'Assistant voice output off'}
              onclick={toggleHearRepliesFromHeader}
            >
              {#if hearRepliesOn}
                <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
              {:else}
                <VolumeX size={16} strokeWidth={2} aria-hidden="true" />
              {/if}
            </button>
            {#if messages.length > 0}
              <button
                type="button"
                class="delete-chat-btn"
                onclick={requestDeleteCurrentChat}
                title="Delete chat"
                aria-label="Delete chat"
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            {/if}
          </div>
        {/snippet}
      </PaneL2Header>
    </div>
    {/if}

    <div
      class="mid-outer"
      class:mid-outer--empty={centerEmptyInPane}
      class:mid-outer--bridge-slide={bridgeSlideLayout}
    >
    <!-- Always mounted so it is visible behind the overlay during the slide-out animation -->
    {#if bridgeSlideLayout}
      <div class="transcript-slide-stack">
        <div class="mid" inert={conversationHidden || undefined}>
          <ConversationView
            bind:this={conversationEl}
            {messages}
            {streaming}
            toolDisplayMode={toolDisplayMode}
            {onOpenWiki}
            {onOpenFile}
            {onOpenEmail}
            {onOpenDraft}
            {onOpenFullInbox}
            {onOpenMessageThread}
            {onSwitchToCalendar}
            {onOpenMailSearchResults}
            {onOpenWikiAbout}
            streamingWrite={streamingWritePreview}
            {multiTenant}
          />
        </div>
        {#if mobileDetail}
          <div class="mobile-detail-layer mobile-detail-layer--over-transcript">
            {@render mobileDetail()}
          </div>
        {/if}
      </div>
    {:else}
      <div class="mid" inert={conversationHidden || undefined}>
        <ConversationView
          bind:this={conversationEl}
          {messages}
          {streaming}
          toolDisplayMode={toolDisplayMode}
          {onOpenWiki}
          {onOpenFile}
          {onOpenEmail}
          {onOpenDraft}
          {onOpenFullInbox}
          {onOpenMessageThread}
          {onSwitchToCalendar}
          {onOpenMailSearchResults}
          {onOpenWikiAbout}
          streamingWrite={streamingWritePreview}
          {multiTenant}
        />
      </div>
    {/if}

    {#if !hideInput}
      <div class="composer-stack" class:composer-stack--bridge-dock={bridgeSlideLayout}>
        <div bind:this={contextBarWrapEl} class="context-bar-overlay">
          <ComposerContextBar
            files={contextBarFiles}
            choices={contextBarChoices}
            choicesDisabled={streaming}
            {onOpenWiki}
            onChoice={(t) => void send(t)}
          />
        </div>
        <UnifiedChatComposer
          bind:this={inputEl}
          voiceEligible={voiceComposerEligible}
          sessionResetKey={unifiedComposerSessionResetKey}
          {placeholder}
          {streaming}
          queuedMessages={pendingQueuedMessages}
          {wikiFiles}
          skills={skillsList}
          transparentSurround={bridgeSlideLayout}
          onNewChat={showComposerNewChat && onUserInitiatedNewChat
            ? () => onUserInitiatedNewChat()
            : undefined}
          onSend={send}
          onStop={stopChat}
          onDraftChange={onAgentInputDraftChange}
          onTranscribe={onVoiceTranscribe}
          onRequestFocusText={() => void focusAgentTextarea(0)}
          hearReplies={hearRepliesForChatComposer}
        />
      </div>
    {/if}

    </div>

    {#if conversationHidden && mobileDetail && !bridgeSlideLayout}
      <div class="mobile-detail-layer mobile-detail-layer--full">
        {@render mobileDetail()}
      </div>
    {/if}
    </div>
  </div>

  <ConfirmDialog
    open={pendingDelete !== null}
    title="Delete chat?"
    titleId="agent-chat-delete-title"
    confirmLabel="Delete"
    cancelLabel="Cancel"
    confirmVariant="danger"
    onDismiss={cancelDeleteCurrentChat}
    onConfirm={() => void confirmDeleteCurrentChat()}
  >
    {#snippet children()}
      {#if pendingDelete}
        <p>This will permanently remove "{pendingDelete.label}".</p>
      {/if}
    {/snippet}
  </ConfirmDialog>
</div>

<style>
  .agent-chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-2);
    min-height: 0;
    min-width: 0;
    overflow-x: hidden;
  }

  .chat-body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow-x: hidden;
  }

  .chat-top {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }

  .mid-outer {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .mid-outer--empty {
    justify-content: center;
  }

  .mid-outer--empty .mid {
    flex: 0 1 auto;
    min-height: 0;
  }

  .mid-outer--bridge-slide {
    min-height: 0;
    /* Column uses --bg-2; paint this stack like the document surface so the dock is not a grey bar */
    background: var(--bg);
  }

  .transcript-slide-stack {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .composer-stack {
    position: relative;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  /** Floats the context bar above the composer, overlaying the bottom of the transcript. */
  .context-bar-overlay {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    z-index: 2;
    pointer-events: none;
  }

  /** Re-enable pointer events for the chips themselves. */
  .context-bar-overlay :global(.composer-context-bar) {
    pointer-events: auto;
  }

  .composer-stack--bridge-dock {
    /* Same surface as .mid-outer--bridge-slide (overrides any inherited --bg-2) */
    background: var(--bg);
  }

  @media (max-width: 767px) {
    .composer-stack {
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
  }

  /* Same width as .conversation when chat is full-width (no detail split) */
  @media (min-width: 768px) {
    :global(.split:not(.has-detail)) .composer-stack {
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

  .context-chip {
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.8;
  }

  /* Match SlideOver `.your-wiki-header-actions`: inset from the L2 right edge. */
  .pane-header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    flex-shrink: 0;
    min-width: 0;
    margin-inline-end: 4px;
  }

  .hear-replies-header-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 4px;
    flex-shrink: 0;
    color: var(--text-2);
    opacity: 1;
    transition: color 0.15s, background 0.15s;
  }
  .hear-replies-header-btn :global(svg) {
    flex-shrink: 0;
  }
  .hear-replies-header-btn--on {
    color: var(--accent);
  }

  .delete-chat-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 4px;
    flex-shrink: 0;
    color: var(--text-2);
    opacity: 1;
    transition: color 0.15s, background 0.15s;
  }
  .delete-chat-btn :global(svg) {
    flex-shrink: 0;
  }

  @media (hover: hover) {
    .hear-replies-header-btn:hover {
      color: var(--text);
      background: var(--bg-3);
    }
    .hear-replies-header-btn--on:hover {
      color: var(--accent);
    }
    .delete-chat-btn:hover {
      color: var(--text);
      background: var(--bg-3);
    }
  }

  /* Tap-friendly targets (iOS 44pt minimum); default compact on desktop. */
  @media (max-width: 767px) {
    .pane-header-actions {
      gap: 6px;
    }
    .hear-replies-header-btn,
    .delete-chat-btn {
      min-width: 44px;
      min-height: 44px;
      padding: 0;
    }
    .hear-replies-header-btn :global(svg),
    .delete-chat-btn :global(svg) {
      width: 20px;
      height: 20px;
    }
  }

  .mid {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow-x: hidden;
    position: relative;
  }

  .mobile-detail-layer {
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .mobile-detail-layer--over-transcript {
    position: absolute;
    inset: 0;
  }

  .mobile-detail-layer--full {
    position: absolute;
    inset: 0;
  }

  .mobile-detail-layer :global(.slide-over) {
    border-left: none;
    flex: 1;
    min-height: 0;
  }
</style>
