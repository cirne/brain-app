<script lang="ts">
  import { onMount, tick, untrack, type Component, type Snippet } from 'svelte'
  import { type SurfaceContext } from '@client/router.js'
  import type {
    AgentConversationViewProps,
    ConversationScrollApi,
    EmptyChatNotificationsProps,
  } from '@client/lib/agentConversationViewTypes.js'
  import type { ContentCardPreview } from '@client/lib/cards/contentCards.js'
  import {
    buildChatBody,
    contextPlaceholder,
    ensureChatMessageIds,
    extractMentionedFiles,
    extractReferencedFiles,
    newChatMessageId,
    sumAssistantUsageTotalTokens,
    type ChatMessage,
    type SkillMenuItem,
  } from '@client/lib/agentUtils.js'
  import { extractLatestSuggestReplyChoices } from '@client/lib/tools/suggestReplyChoices.js'
  import { emit, subscribe as subscribeAppEvents } from '@client/lib/app/appEvents.js'
  import { ensureBrainTtsAutoplayInUserGesture, stopBrainTtsPlayback } from '@client/lib/brainTtsAudio.js'
  import { readChatToolDisplayPreference } from '@client/lib/chatToolDisplayPreference.js'
  import { readHearRepliesPreference, writeHearRepliesPreference } from '@client/lib/hearRepliesPreference.js'
  import { registerWikiFileListRefetch } from '@client/lib/wikiFileListRefetch.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'

  function notifyChatSessionsChanged() {
    emit({ type: 'chat:sessions-changed' })
  }
  import { consumeAgentChatStream } from '@client/lib/agentChat/streamClient.js'
  import { apiFetch } from '@client/lib/apiFetch.js'
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
  import { isBrainFinishConversationSubmit } from '@shared/finishConversationShortcut.js'
  import {
    EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP,
    EMPTY_CHAT_NOTIFICATION_FETCH_LIMIT,
    presentationForNotificationRow,
    type NotificationKickoffHints,
  } from '@shared/notifications/presentation.js'
  import { Trash2, Volume2, VolumeX } from 'lucide-svelte'
  import AgentConversation from '@components/agent-conversation/AgentConversation.svelte'
  import EmptyChatNotificationsStrip from '@components/agent-conversation/EmptyChatNotificationsStrip.svelte'
  import ComposerContextBar from '@components/agent-conversation/ComposerContextBar.svelte'
  import { isPressToTalkEnabled } from '@client/lib/pressToTalkEnabled.js'
  import { applyVoiceTranscriptToChat } from '@client/lib/voiceTranscribeRouting.js'
  import UnifiedChatComposer from '@components/UnifiedChatComposer.svelte'
  import WikiFileName from '@components/WikiFileName.svelte'
  import PaneL2Header from '@components/PaneL2Header.svelte'
  import ConversationTokenMeter from '@components/ConversationTokenMeter.svelte'
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import { labelForDeleteChatDialog } from '@client/lib/chatHistoryDelete.js'
  import type { AgentOpenSource } from '@client/lib/navigateFromAgentOpen.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

  let {
    context = { type: 'none' } as SurfaceContext,
    conversationHidden = false,
    /** When true, agent tools do not auto-open the right detail panel (wiki from write/edit, **`open`**, **`draft_email`** overlay, …). */
    suppressAgentDetailAutoOpen = false,
    onOpenWiki,
    onOpenFile,
    onOpenIndexedFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onOpenMessageThread,
    onSwitchToCalendar,
    onOpenMailSearchResults,
    onOpenVisualArtifact,
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
     * Also used as the fallback when {@link onAgentFinishConversation} is unset after a successful
     * SSE `finish_conversation` (embeds/tests that only need “same as new chat”).
     */
    onUserInitiatedNewChat = undefined as (() => void) | undefined,
    /**
     * After the stream completes a successful `finish_conversation` tool (including the wire
     * shortcut). Hosts compose behavior here: e.g. main shell runs onboarding finalize vs
     * `historyNewChat`, Hub closes a panel, onboarding interview runs finalize. When unset,
     * {@link onUserInitiatedNewChat} is used instead.
     */
    onAgentFinishConversation = undefined as (() => void | Promise<void>) | undefined,
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
    headerFallbackTitle = $t('chat.agentChat.headerFallbackTitle'),
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
    /** Mobile OPP-092: hide chat `PaneL2Header` while a foreground overlay covers the chat column. */
    suppressMobileChatL2Header = false,
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
    /** Fires whenever the displayed session's hearReplies flag changes (for parent UI like overflow menus). */
    onHearRepliesChange = undefined as ((_on: boolean) => void) | undefined,
    /** When true (default), empty main chat fetches unread notifications for the strip above empty copy. */
    showEmptyChatNotifications = true,
  }: {
    context?: SurfaceContext
    conversationHidden?: boolean
    suppressAgentDetailAutoOpen?: boolean
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMailSearchResults?: (
      _preview: Extract<ContentCardPreview, { kind: 'mail_search_hits' }>,
      _sourceId: string,
    ) => void
    onOpenVisualArtifact?: (_ref: string, _label?: string) => void
    /** LLM `open` — fired from SSE `tool_start` */
    onOpenFromAgent?: (
      _target: { type: string; path?: string; id?: string; date?: string; source?: string },
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
    onAgentFinishConversation?: () => void | Promise<void>
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
    suppressMobileChatL2Header?: boolean
    inputPlaceholder?: string
    multiTenant?: boolean
    mobileSlideCoversTranscriptOnly?: boolean
    autoSendInterviewKickoffHidden?: boolean
    onHearRepliesChange?: (_on: boolean) => void
    showEmptyChatNotifications?: boolean
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
  let prevDisplayedSession: string | null | undefined = undefined
  /** Stop any in-flight assistant TTS when switching threads so stale blobs don’t stack on the shared AudioContext. */
  $effect(() => {
    const id = displayedSessionId
    if (prevDisplayedSession !== undefined && prevDisplayedSession !== id) {
      stopBrainTtsPlayback()
    }
    prevDisplayedSession = id
  })
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

  let emptyChatNotificationsPayload = $state<EmptyChatNotificationsProps | null>(null)

  const contextBarFiles = $derived(extractReferencedFiles(messages))
  const conversationTokenTotal = $derived(sumAssistantUsageTotalTokens(messages))

  export function getConversationTokenMeterTotal(): number {
    return conversationTokenTotal
  }

  /** For shell routing (search / history rail): whether the chat column is an empty transcript and not streaming. */
  export function getShellRoutingEmptyDetailState(): { transcriptEmpty: boolean; streaming: boolean } {
    return { transcriptEmpty: messages.length === 0, streaming }
  }
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

  $effect(() => {
    const on = hearRepliesForChatComposer
    untrack(() => onHearRepliesChange?.(on))
  })

  /** Survives pending → server session id migration; keeps UnifiedChatComposer voice mode across SSE `session`. */
  const unifiedComposerSessionResetKey = $derived.by((): string => {
    const id = displayedSessionId
    if (!id) return ''
    const k = sessions.get(id)?.composerResetKey?.trim()
    return k ? k : id
  })

  $effect(() => {
    const s = streaming
    untrack(() => onStreamingChange?.(s))
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
      const res = await apiFetch('/api/skills')
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
      const res = await apiFetch('/api/wiki')
      if (!res.ok) return
      const data: unknown = await res.json()
      wikiFiles = parseWikiListApiBody(data).files.map((f) => f.path)
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
    if (m) void tick().then(() => send(m, undefined, autoSendInterviewKickoffHidden))
    return () => {
      unsubWikiList()
      unsubPrefs()
    }
  })

  export function newChat(options?: { skipOverlayClose?: boolean }) {
    const prev = displayedSessionId
    if (prev) {
      sessions = touchSessionImmutable(sessions, prev, { notificationIdMarkReadOnFinish: null })
    }
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
      const res = await apiFetch(`/api/chat/sessions/${encodeURIComponent(loadId)}`, { signal })
      if (sessionLoadLatest.isStale(token)) {
        return
      }
      if (!res.ok) {
        const err = emptySession()
        err.messages = [
          {
            id: newChatMessageId(),
            role: 'assistant',
            content: $t('chat.agentChat.loadFailedWithStatus', { status: res.status }),
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
      const list = ensureChatMessageIds(Array.isArray(doc.messages) ? doc.messages : [])
      const sid = typeof doc.sessionId === 'string' ? doc.sessionId : loadId
      sessions = setSessionImmutable(sessions, sid, {
        messages: list,
        streaming: false,
        abortController: null,
        sessionId: sid,
        chatTitle: doc.title ?? null,
        pendingQueuedMessages: [],
        hearReplies: readHearRepliesPreference(),
        notificationIdMarkReadOnFinish: null,
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
        messages: [{ id: newChatMessageId(), role: 'assistant', content: $t('chat.agentChat.loadFailed') }],
        streaming: false,
        abortController: null,
        sessionId: null,
        chatTitle: null,
        pendingQueuedMessages: [],
        hearReplies: readHearRepliesPreference(),
        notificationIdMarkReadOnFinish: null,
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
    stopBrainTtsPlayback()
    sessions.get(id)?.abortController?.abort()
  }

  /**
   * @param forSessionKey — when set (e.g. queued follow-up after a background stream ends), send targets this map key instead of the currently displayed session.
   * @param interviewKickoffHidden — guided onboarding interview route: no user bubble; server prepends `ripmail whoami` to this message.
   * @param sendOpts.initialBootstrapKickoff — unified bootstrap on main `/api/chat` (empty visible user turn).
   * @param sendOpts.userBubbleText — shown in the user bubble when different from wire `text` (e.g. finish chip label).
   * @param sendOpts.notificationKickoff — POST-only hints for empty-chat notification strip (not persisted in user bubble).
   */
  async function send(
    text: string,
    forSessionKey?: string,
    interviewKickoffHidden = false,
    sendOpts?: {
      userBubbleText?: string
      initialBootstrapKickoff?: boolean
      notificationKickoff?: NotificationKickoffHints
    },
  ) {
    const initialBootstrapKickoff = sendOpts?.initialBootstrapKickoff === true
    const id = forSessionKey ?? displayedSessionId
    if ((!text?.trim() && !initialBootstrapKickoff) || !id) return
    const st = sessions.get(id)
    if (!st) return

    if (st.streaming) {
      if (initialBootstrapKickoff || interviewKickoffHidden) return
      const t = text.trim()
      if (!t) return
      const prev = st.pendingQueuedMessages ?? []
      sessions = touchSessionImmutable(sessions, id, { pendingQueuedMessages: [...prev, t] })
      return
    }

    if (displayedSessionId === id) {
      stopBrainTtsPlayback()
    }

    const streamKey = id
    let activeKey = streamKey
    const mentionedFiles =
      initialBootstrapKickoff || interviewKickoffHidden ? [] : extractMentionedFiles(text)
    const isFirstMessage = st.messages.length === 0

    const hideUserBubble = initialBootstrapKickoff || interviewKickoffHidden
    const userBubbleContent = sendOpts?.userBubbleText ?? text
    const nextMessages = hideUserBubble
      ? [...st.messages, { id: newChatMessageId(), role: 'assistant' as const, content: '', parts: [] }]
      : [
          ...st.messages,
          { id: newChatMessageId(), role: 'user' as const, content: userBubbleContent },
          { id: newChatMessageId(), role: 'assistant' as const, content: '', parts: [] },
        ]
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
      initialBootstrapKickoff,
      interviewKickoff: interviewKickoffHidden,
      hearReplies: st.hearReplies === true,
      userMessageDisplay: sendOpts?.userBubbleText?.trim()
        ? sendOpts.userBubbleText.trim()
        : undefined,
      notificationKickoff: sendOpts?.notificationKickoff,
    })

    if (!hideUserBubble) onUserSendMessage?.()

    let sawDone = false
    let touchedWiki = false
    let closedWithDeferredFinish = false

    try {
      const res = await apiFetch(chatEndpoint, {
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
        onFinishConversation: async () => {
          await markNotificationReadAfterFinish(activeKey)
          if (onAgentFinishConversation) await Promise.resolve(onAgentFinishConversation())
          else onUserInitiatedNewChat?.()
        },
      })
      touchedWiki = result.touchedWiki
      sawDone = result.sawDone
      closedWithDeferredFinish = result.deferredFinishConversation
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
      if (sawDone && (displayedSessionId === activeKey || closedWithDeferredFinish)) void onStreamFinished?.()

      const { next: queued, rest: queueRest } = shiftQueuedFollowUp(
        sessions.get(activeKey)?.pendingQueuedMessages,
      )
      if (queued) {
        sessions = touchSessionImmutable(sessions, activeKey, { pendingQueuedMessages: queueRest })
        void send(queued, activeKey)
      }
    }
  }

  async function markNotificationReadAfterFinish(sessionKey: string) {
    const nid = sessions.get(sessionKey)?.notificationIdMarkReadOnFinish?.trim()
    if (!nid) return
    try {
      const res = await apiFetch(`/api/notifications/${encodeURIComponent(nid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'read' }),
      })
      if (!res.ok) return
      sessions = touchSessionImmutable(sessions, sessionKey, { notificationIdMarkReadOnFinish: null })
      await refreshEmptyChatNotifications()
    } catch {
      /* ignore */
    }
  }

  async function dismissNotification(id: string) {
    try {
      const res = await apiFetch(`/api/notifications/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'dismissed' }),
      })
      if (!res.ok) return
      const sid = displayedSessionId
      if (sid) {
        const cur = sessions.get(sid)
        if (cur?.notificationIdMarkReadOnFinish === id) {
          sessions = touchSessionImmutable(sessions, sid, { notificationIdMarkReadOnFinish: null })
        }
      }
      await refreshEmptyChatNotifications()
    } catch {
      /* ignore */
    }
  }

  async function refreshEmptyChatNotifications(signal?: AbortSignal) {
    try {
      const res = await apiFetch(
        `/api/notifications?state=unread&limit=${EMPTY_CHAT_NOTIFICATION_FETCH_LIMIT}`,
        signal ? { signal } : {},
      )
      if (!res.ok) {
        if (!signal?.aborted) emptyChatNotificationsPayload = null
        return
      }
      const rows = (await res.json()) as Array<{
        id: string
        sourceKind: string
        payload: unknown
        summaryLine?: string
        kickoffUserMessage?: string
        kickoffHints?: NotificationKickoffHints
      }>
      if (signal?.aborted) return
      const mapped = rows.map((r) =>
        r.summaryLine != null &&
        r.kickoffUserMessage != null &&
        r.kickoffHints != null &&
        typeof r.summaryLine === 'string' &&
        typeof r.kickoffUserMessage === 'string'
          ? {
              id: r.id,
              sourceKind: r.sourceKind,
              summaryLine: r.summaryLine,
              kickoffUserMessage: r.kickoffUserMessage,
              kickoffHints: r.kickoffHints,
            }
          : presentationForNotificationRow({ id: r.id, sourceKind: r.sourceKind, payload: r.payload }),
      )
      if (mapped.length === 0) {
        emptyChatNotificationsPayload = null
        return
      }
      const hasMore = mapped.length > EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP
      const items = mapped.slice(0, EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP)
      emptyChatNotificationsPayload = {
        items,
        hasMore,
        onAct: (row) => {
          const sid = displayedSessionId
          if (!sid) return
          sessions = touchSessionImmutable(sessions, sid, { notificationIdMarkReadOnFinish: row.id })
          void send(row.kickoffUserMessage, undefined, false, { notificationKickoff: row.kickoffHints })
        },
        onDismiss: (nid: string) => void dismissNotification(nid),
      }
    } catch (e: unknown) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      emptyChatNotificationsPayload = null
    }
  }

  const EMPTY_CHAT_NOTIFICATIONS_POLL_MS = 20_000

  $effect(() => {
    const eligible =
      showEmptyChatNotifications === true && !hideInput && messages.length === 0 && !streaming
    if (!eligible) {
      emptyChatNotificationsPayload = null
      return
    }
    const ac = new AbortController()
    void refreshEmptyChatNotifications(ac.signal)
    const pollId = setInterval(() => {
      void refreshEmptyChatNotifications()
    }, EMPTY_CHAT_NOTIFICATIONS_POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshEmptyChatNotifications()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(pollId)
      document.removeEventListener('visibilitychange', onVisibility)
      ac.abort()
    }
  })

  /** Empty thread on `/api/chat` while onboarding-agent: assistant opens with merged bootstrap prompt. */
  export async function sendInitialBootstrapKickoff(forSessionKey?: string) {
    await send('', forSessionKey, false, { initialBootstrapKickoff: true })
  }

  export function canSendInitialBootstrapKickoff(): boolean {
    const id = displayedSessionId
    if (!id) return false
    const st = sessions.get(id)
    return !!st && !st.streaming && st.messages.length === 0
  }

  export function getDisplayedLocalSessionKey(): string | null {
    return displayedSessionId
  }

  const placeholder = $derived(
    inputPlaceholder ?? contextPlaceholder(context, messages.length > 0),
  )

  const contextChip = $derived.by((): string | null => {
    if (context.type === 'email') return `📧 ${context.subject}`
    if (context.type === 'calendar') return `📅 ${context.date}`
    if (context.type === 'inbox') return `📥 ${$t('chat.agentChat.inboxContextLabel')}`
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

  const showEmptyNotificationStrip = $derived.by(() => {
    const p = emptyChatNotificationsPayload
    return (
      showEmptyChatNotifications &&
      !hideInput &&
      messages.length === 0 &&
      !streaming &&
      p != null &&
      (p.items.length > 0 || p.hasMore)
    )
  })

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

  export function toggleHearRepliesFromHeader() {
    const id = displayedSessionId
    if (!id) return
    const cur = sessions.get(id)?.hearReplies ?? false
    if (cur === false) {
      void ensureBrainTtsAutoplayInUserGesture()
    }
    const next = !cur
    if (next === false) {
      stopBrainTtsPlayback()
    }
    writeHearRepliesPreference(next)
    sessions = touchSessionImmutable(sessions, id, { hearReplies: next })
  }

  export function requestDeleteCurrentChat() {
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
        const res = await apiFetch(`/api/chat/${encodeURIComponent(serverId)}`, { method: 'DELETE' })
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

  const iconBtnClass =
    'inline-flex shrink-0 items-center justify-center p-1 text-muted opacity-100 transition-colors duration-150 hover:bg-surface-3 hover:text-foreground max-md:min-h-11 max-md:min-w-11 max-md:p-0 max-md:[&_svg]:h-5 max-md:[&_svg]:w-5 [&_svg]:shrink-0'
</script>

<div class="agent-chat flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-surface">
  <div
    class="chat-body relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden"
    style:--composer-context-overlap-pad={showComposerContextBar && contextBarActualHeight > 0
      ? `${contextBarActualHeight}px`
      : '0'}
  >
    <div class="chat-top relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {#if !centerEmptyInPane && !suppressMobileChatL2Header}
    <!-- Always in flex flow — prevents height jump when overlay opens/closes -->
    <div inert={conversationHidden || undefined}>
      <PaneL2Header>
        {#snippet center()}
          <div class="header-left flex min-w-0 items-center gap-2 overflow-hidden">
            <span
              class={cn(
                'chat-title text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-muted',
                chatTitle
                  ? 'custom-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap normal-case tracking-[0.02em]'
                  : 'shrink-0',
              )}
              aria-label={streaming &&
              !(streamingBusyLabel ?? '').trim() &&
              !(chatTitle ?? '').trim()
                ? $t('chat.messageRow.assistantWorkingAria')
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
                <span class="context-chip overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted opacity-80"
                  ><WikiFileName path={context.path} /></span>
              {:else if context.type === 'file'}
                <span class="context-chip overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted opacity-80"
                  ><WikiFileName path={context.path} /></span>
              {:else if contextChip}
                <span class="context-chip overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted opacity-80"
                  >{contextChip}</span>
              {/if}
            {/if}
          </div>
        {/snippet}
        {#snippet right()}
          {@const hearRepliesOn = sessions.get(displayedSessionId)?.hearReplies === true}
          <div class="pane-header-actions flex min-w-0 shrink-0 items-center justify-end gap-0.5 me-1 max-md:gap-1.5">
            <ConversationTokenMeter totalTokens={conversationTokenTotal} />
            <button
              type="button"
              class={cn(
                'hear-replies-header-btn',
                iconBtnClass,
                hearRepliesOn && 'hear-replies-header-btn--on text-accent hover:text-accent',
              )}
              aria-pressed={hearRepliesOn}
              title={$t('chat.agentChat.hearRepliesToggleTitle')}
              aria-label={hearRepliesOn
                ? $t('chat.agentChat.hearRepliesOnAria')
                : $t('chat.agentChat.hearRepliesOffAria')}
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
                class={cn('delete-chat-btn', iconBtnClass)}
                onclick={requestDeleteCurrentChat}
                title={$t('chat.agentChat.deleteChatAria')}
                aria-label={$t('chat.agentChat.deleteChatAria')}
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            {/if}
          </div>
        {/snippet}
      </PaneL2Header>
    </div>
    {/if}

    {#snippet unifiedComposerStack()}
      {#if !hideInput}
        <div
          class={cn(
            /* Same horizontal inset as `.chat-transcript-inner` — composer is a sibling of the scroll area, not inside it. */
            'composer-stack relative box-border flex shrink-0 flex-col px-[length:var(--chat-transcript-px)] max-md:pb-[env(safe-area-inset-bottom,0px)]',
            bridgeSlideLayout && 'composer-stack--bridge-dock bg-surface',
          )}
        >
          <div
            bind:this={contextBarWrapEl}
            class="context-bar-overlay pointer-events-none absolute inset-x-0 bottom-full z-[2]"
          >
            <ComposerContextBar
              files={contextBarFiles}
              choices={contextBarChoices}
              choicesDisabled={streaming}
              {onOpenWiki}
              onChoice={(c) =>
                void send(c.submit, undefined, autoSendInterviewKickoffHidden, {
                  userBubbleText: isBrainFinishConversationSubmit(c.submit) ? c.label : undefined,
                })}
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
          {#if centerEmptyInPane && !bridgeSlideLayout}
            <div class="audio-conv-toggle-row md:hidden flex items-center justify-center pb-3 pt-1">
              <button
                type="button"
                role="switch"
                aria-checked={hearRepliesForChatComposer}
                aria-label={$t('chat.agentChat.audioConversation')}
                class={cn(
                  'audio-conv-toggle inline-flex items-center gap-2.5 rounded-sm',
                  'px-4 py-2 text-md transition-colors duration-150',
                )}
                onclick={toggleHearRepliesFromHeader}
              >
                <Volume2 size={15} strokeWidth={2} aria-hidden="true" />
                <span>{$t('chat.agentChat.audioConversation')}</span>
                <span
                  class={cn(
                    'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200',
                    hearRepliesForChatComposer ? 'bg-accent' : 'bg-muted/30',
                  )}
                  aria-hidden="true"
                >
                  <span
                    class={cn(
                      'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                      hearRepliesForChatComposer ? 'translate-x-4' : 'translate-x-0',
                    )}
                  ></span>
                </span>
              </button>
            </div>
          {/if}
        </div>
      {/if}
    {/snippet}

    <div
      class={cn(
        'mid-outer box-border flex min-h-0 min-w-0 flex-1 flex-col',
        centerEmptyInPane && 'mid-outer--empty justify-start',
        bridgeSlideLayout && 'mid-outer--bridge-slide bg-surface',
      )}
    >
      {#if showEmptyNotificationStrip && emptyChatNotificationsPayload}
        <div class="shrink-0 px-[length:var(--chat-transcript-px)] pb-1">
          <EmptyChatNotificationsStrip notifications={emptyChatNotificationsPayload} />
        </div>
      {/if}

      {#if centerEmptyInPane}
        <div class="mid-empty-hero flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-5">
          {#if bridgeSlideLayout}
            <div class="transcript-slide-stack relative flex w-full flex-none flex-col min-h-0 min-w-0">
              <div
                class="mid relative flex min-h-0 w-full flex-none flex-col overflow-x-hidden"
                inert={conversationHidden || undefined}
              >
                <ConversationView
                  bind:this={conversationEl}
                  {messages}
                  {streaming}
                  toolDisplayMode={toolDisplayMode}
                  {onOpenWiki}
                  {onOpenFile}
                  {onOpenIndexedFile}
                  {onOpenEmail}
                  {onOpenDraft}
                  {onOpenFullInbox}
                  {onOpenMessageThread}
                  {onSwitchToCalendar}
                  {onOpenMailSearchResults}
                  {onOpenVisualArtifact}
                  {onOpenWikiAbout}
                  streamingWrite={streamingWritePreview}
                  {multiTenant}
                />
              </div>
              {#if mobileDetail}
                <div class="mobile-detail-layer mobile-detail-layer--over-transcript absolute inset-0 z-10 flex min-h-0 flex-col">
                  {@render mobileDetail()}
                </div>
              {/if}
            </div>
          {:else}
            <div
              class="mid relative flex min-h-0 w-full flex-none flex-col overflow-x-hidden"
              inert={conversationHidden || undefined}
            >
              <ConversationView
                bind:this={conversationEl}
                {messages}
                {streaming}
                toolDisplayMode={toolDisplayMode}
                {onOpenWiki}
                {onOpenFile}
                {onOpenIndexedFile}
                {onOpenEmail}
                {onOpenDraft}
                {onOpenFullInbox}
                {onOpenMessageThread}
                {onSwitchToCalendar}
                {onOpenMailSearchResults}
                {onOpenVisualArtifact}
                {onOpenWikiAbout}
                streamingWrite={streamingWritePreview}
                {multiTenant}
              />
            </div>
          {/if}
          {@render unifiedComposerStack()}
        </div>
      {:else}
        {#if bridgeSlideLayout}
          <div class="transcript-slide-stack relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              class="mid relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden"
              inert={conversationHidden || undefined}
            >
              <ConversationView
                bind:this={conversationEl}
                {messages}
                {streaming}
                toolDisplayMode={toolDisplayMode}
                {onOpenWiki}
                {onOpenFile}
                {onOpenIndexedFile}
                {onOpenEmail}
                {onOpenDraft}
                {onOpenFullInbox}
                {onOpenMessageThread}
                {onSwitchToCalendar}
                {onOpenMailSearchResults}
                {onOpenVisualArtifact}
                {onOpenWikiAbout}
                streamingWrite={streamingWritePreview}
                {multiTenant}
              />
            </div>
            {#if mobileDetail}
              <div class="mobile-detail-layer mobile-detail-layer--over-transcript absolute inset-0 z-10 flex min-h-0 flex-col">
                {@render mobileDetail()}
              </div>
            {/if}
          </div>
        {:else}
          <div
            class="mid relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden"
            inert={conversationHidden || undefined}
          >
            <ConversationView
              bind:this={conversationEl}
              {messages}
              {streaming}
              toolDisplayMode={toolDisplayMode}
              {onOpenWiki}
              {onOpenFile}
              {onOpenIndexedFile}
              {onOpenEmail}
              {onOpenDraft}
              {onOpenFullInbox}
              {onOpenMessageThread}
              {onSwitchToCalendar}
              {onOpenMailSearchResults}
              {onOpenVisualArtifact}
              {onOpenWikiAbout}
              streamingWrite={streamingWritePreview}
              {multiTenant}
            />
          </div>
        {/if}
        {@render unifiedComposerStack()}
      {/if}

    </div>

    {#if conversationHidden && mobileDetail && !bridgeSlideLayout}
      <div class="mobile-detail-layer mobile-detail-layer--full absolute inset-0 z-10 flex min-h-0 flex-col">
        {@render mobileDetail()}
      </div>
    {/if}
    </div>
  </div>

  <ConfirmDialog
    open={pendingDelete !== null}
    title={$t('chat.agentChat.deleteDialogTitle')}
    titleId="agent-chat-delete-title"
    confirmLabel={$t('chat.agentChat.deleteConfirmLabel')}
    cancelLabel={$t('common.actions.cancel')}
    confirmVariant="danger"
    onDismiss={cancelDeleteCurrentChat}
    onConfirm={() => void confirmDeleteCurrentChat()}
  >
    {#if pendingDelete}
      <p>{$t('chat.agentChat.deleteDialogBody', { label: pendingDelete.label })}</p>
    {/if}
  </ConfirmDialog>
</div>

<style>
  /* Re-enable pointer events for the chips themselves (overlay is pointer-events:none). */
  .context-bar-overlay :global(.composer-context-bar) {
    pointer-events: auto;
  }

  /* Slide-over inside `.mobile-detail-layer` should not paint a left border and must fill the layer. */
  .mobile-detail-layer :global(.slide-over) {
    border-left: none;
    flex: 1;
    min-height: 0;
  }

  /**
   * Chat-only split: limit readable column width + center. Horizontal padding uses `--chat-transcript-px` on
   * `.composer-stack` so the input matches `.chat-transcript-inner` in every layout (including `.has-detail`).
   * Tailwind `mx-auto` on a flex item is defeated by `align-items: stretch` on the column parent.
   */
  @media (min-width: 768px) {
    :global(.split:not(.has-detail)) .composer-stack {
      width: 100%;
      max-width: var(--chat-column-max);
      margin-left: auto;
      margin-right: auto;
    }
  }
</style>
