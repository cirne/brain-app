<script lang="ts">
  /**
   * Same assistant shell as the main app (WorkspaceSplit + AgentChat + SlideOver)
   * without chat history sidebar, so onboarding can open email/wiki/calendar while the agent runs.
   */
  import { onMount } from 'svelte'
  import { countSeedEligibleWikiPages } from '@client/lib/onboarding/seedWikiPageCount.js'
  import { t } from '@client/lib/i18n/index.js'
  import Search from '@components/Search.svelte'
  import AppTopNav from '@components/AppTopNav.svelte'
  import SlideOver from '@components/shell/SlideOver.svelte'
  import AgentChat from '@components/AgentChat.svelte'
  import AgentConversation from '@components/agent-conversation/AgentConversation.svelte'
  import OnboardingProfilingView from './OnboardingProfilingView.svelte'
  import OnboardingSeedingView from './OnboardingSeedingView.svelte'
  import WorkspaceSplit from '@components/WorkspaceSplit.svelte'
  import {
    parseRoute,
    navigate,
    readTailFromCache,
    type Route,
    type SurfaceContext,
    type Overlay,
  } from '@client/router.js'
  import { runParallelSyncs } from '@client/lib/app/syncAllServices.js'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { matchGlobalShortcut } from '@client/lib/app/globalShortcuts.js'
  import { tryDismissTipTapFloatingMenuFromEscape } from '@client/lib/tiptapFloatingMenuEscape.js'
  import { wikiPathForReadToolArg } from '@client/lib/cards/contentCards.js'
  import { navigateFromAgentOpen, type AgentOpenSource } from '@client/lib/navigateFromAgentOpen.js'
  import { WORKSPACE_DESKTOP_SPLIT_MIN_PX } from '@client/lib/app/workspaceLayout.js'
  import { ONBOARDING_DEFAULT_CHAT_STORAGE_KEY } from '@client/lib/onboarding/onboardingStorageKeys.js'
  import { onboardingHidesComposerForActivityFlow } from '@client/lib/onboarding/onboardingWorkspaceMode.js'
  import { overlaySupportsMobileChatBridge } from '@client/lib/mobileDetailChatOverlay.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'

  const {
    chatEndpoint,
    autoSendMessage,
    onStreamFinished,
    /** Wiki activity for onboarding seed threshold + status bar (seeding endpoint only). */
    onSeedWikiActivity,
    headerFallbackTitle = $t('chat.agentChat.headerFallbackTitle'),
    storageKey = ONBOARDING_DEFAULT_CHAT_STORAGE_KEY,
    /** When true, agent tools never auto-open the right detail panel (desktop + mobile). Default: only suppress on mobile, like the main assistant. */
    suppressAgentDetailAutoOpen = false,
    /** Hosted multi-tenant: alternate profiling lead copy (no local-Mac vault framing). */
    multiTenant = false,
    /** Composer hint; forwarded to AgentChat (e.g. guided onboarding interview). */
    inputPlaceholder = undefined as string | undefined,
    /**
     * Guided interview only: parent implements POST /finalize + exit onboarding. Wired into
     * {@link AgentChat}'s `onAgentFinishConversation` when `chatEndpoint === '/api/onboarding/interview'`.
     */
    onAgentFinishInterview = undefined as (() => void | Promise<void>) | undefined,
  }: {
    chatEndpoint: string
    autoSendMessage: string
    onStreamFinished?: () => void | Promise<void>
    onSeedWikiActivity?: (_info: { pageCount: number; lastDocPath: string | null }) => void
    headerFallbackTitle?: string
    storageKey?: string
    suppressAgentDetailAutoOpen?: boolean
    multiTenant?: boolean
    inputPlaceholder?: string
    onAgentFinishInterview?: () => void | Promise<void>
  } = $props()

  const isSeedingWiki = $derived(chatEndpoint === '/api/onboarding/seed')
  const isProfiling = $derived(
    chatEndpoint === '/api/onboarding/profile' || chatEndpoint === '/api/onboarding/interview',
  )
  /** Profiling + interview + seeding: non-default busy labels / stream chrome (composer visibility is separate). */
  const useOnboardingActivity = $derived(isProfiling || isSeedingWiki)
  const loadingSubjectLabel = $derived($t('onboarding.workspace.loadingSubject'))

  const hideComposerForActivity = $derived(onboardingHidesComposerForActivityFlow(chatEndpoint))

  let route = $state<Route>(parseRoute())
  let syncErrors = $state<string[]>([])
  let showSyncErrors = $state(false)
  let calendarRefreshKey = $state(0)
  let wikiRefreshKey = $state(0)
  let showSearch = $state(false)
  let inboxTargetId = $state<string | undefined>()
  let wikiWriteStreaming = $state<{ path: string; body: string } | null>(null)
  let wikiEditStreaming = $state<{ path: string; toolId: string } | null>(null)
  let agentChat = $state<AgentChat | undefined>()
  let mobileSlideOver = $state<{ closeAnimated: () => void } | undefined>()
  let workspaceSplit = $state<WorkspaceSplit | undefined>()
  let detailPaneFullscreen = $state(false)
  let isMobile = $state(false)
  let workspaceColumnWidth = $state(0)
  const useDesktopSplitDetail = $derived(
    !isMobile && workspaceColumnWidth >= WORKSPACE_DESKTOP_SPLIT_MIN_PX,
  )
  const slideOverCloseAnimated = $derived(!useDesktopSplitDetail && mobileSlideOver)

  let agentContext = $state<SurfaceContext>({ type: 'chat' })

  async function refreshSeedWikiStatus() {
    if (!isSeedingWiki) return
    try {
      const [wikiRes, histRes] = await Promise.all([
        fetch('/api/wiki'),
        fetch('/api/wiki/edit-history?limit=1'),
      ])
      const paths = parseWikiListApiBody(await wikiRes.json())
        .files.map((f) => f.path)
        .filter((p): p is string => typeof p === 'string')
      const pageCount = countSeedEligibleWikiPages(paths)
      const hist = (await histRes.json()) as { files?: { path: string; date: string }[] }
      const lastDocPath = hist.files?.[0]?.path ?? null
      onSeedWikiActivity?.({ pageCount, lastDocPath })
    } catch {
      /* ignore */
    }
  }

  async function handleWorkspaceStreamFinished() {
    await onStreamFinished?.()
  }

  /** For POST /api/onboarding/finalize after the user finishes the interview. */
  export function getInterviewSessionId(): string | null {
    return agentChat?.getBackendSessionId() ?? null
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const syncMobile = () => {
      isMobile = mq.matches
    }
    syncMobile()
    mq.addEventListener('change', syncMobile)

    if (chatEndpoint === '/api/onboarding/seed') {
      void refreshSeedWikiStatus()
    }
    const onPopState = () => {
      route = parseRoute()
    }
    window.addEventListener('popstate', onPopState)
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tryDismissTipTapFloatingMenuFromEscape()) {
        e.preventDefault()
        return
      }
      if (e.key === 'Escape' && route.overlay) {
        e.preventDefault()
        if (slideOverCloseAnimated) slideOverCloseAnimated.closeAnimated()
        else closeOverlay()
        return
      }
      const action = matchGlobalShortcut(e)
      if (!action) return
      e.preventDefault()
      switch (action.type) {
        case 'search':
          showSearch = true
          break
        case 'newChat':
          closeOverlayImmediate()
          agentChat?.newChat()
          break
        case 'refresh':
          void syncAll()
          break
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => {
      mq.removeEventListener('change', syncMobile)
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKeydown)
    }
  })

  function obChatSession(): Pick<Route, 'sessionId'> {
    const sid =
      route.sessionId ?? (route.sessionTail ? readTailFromCache(route.sessionTail) : undefined)
    return sid ? { sessionId: sid } : {}
  }

  function closeOverlayImmediate() {
    navigate({ ...obChatSession() }, { replace: true })
    route = parseRoute()
    agentContext = { type: 'chat' }
    inboxTargetId = undefined
    wikiWriteStreaming = null
    wikiEditStreaming = null
  }

  function closeOverlay() {
    if (!route.overlay) return
    if (useDesktopSplitDetail) {
      workspaceSplit?.closeDesktopAnimated()
      return
    }
    closeOverlayImmediate()
  }

  function closeOverlayOnUserSend() {
    if (!useDesktopSplitDetail && route.overlay) {
      closeOverlayImmediate()
    }
  }

  function wikiOverlayReplace(): boolean {
    const t = route.overlay?.type
    return t === 'wiki' || t === 'wiki-dir'
  }

  function openWikiDoc(path?: string) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = wikiOverlayReplace()
    navigate(
      {...obChatSession(), overlay },
      replace ? { replace: true } : undefined,
    )
    route = parseRoute()
  }

  function onWikiNavigate(path: string | undefined) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = wikiOverlayReplace()
    navigate(
      {...obChatSession(), overlay },
      replace ? { replace: true } : undefined,
    )
    route = parseRoute()
  }

  function openWikiDir(dirPath?: string) {
    const trimmed = dirPath?.trim()
    const overlay: Overlay = trimmed ? { type: 'wiki-dir', path: trimmed } : { type: 'wiki-dir' }
    const replace = wikiOverlayReplace()
    navigate(
      {...obChatSession(), overlay },
      replace ? { replace: true } : undefined,
    )
    route = parseRoute()
  }

  function openFileDoc(path: string) {
    navigate({...obChatSession(), overlay: { type: 'file', path } })
    route = parseRoute()
  }

  function onInboxNavigateSlide(id: string | undefined) {
    const overlay: Overlay = id ? { type: 'email', id } : { type: 'email' }
    navigate({...obChatSession(), overlay })
    route = parseRoute()
  }

  function switchToCalendar(date: string, eventId?: string) {
    navigate({
      ...obChatSession(),
      overlay: { type: 'calendar', date, ...(eventId ? { eventId } : {}) },
    })
    route = parseRoute()
    agentContext = { type: 'calendar', date, ...(eventId ? { eventId } : {}) }
  }

  function resetCalendarToToday() {
    const d = new Date()
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    switchToCalendar(ymd)
  }

  function setContext(ctx: SurfaceContext) {
    agentContext = ctx
  }

  function onSummarizeInbox(message: string) {
    agentContext = { type: 'inbox' }
    void agentChat?.newChatWithMessage(message)
  }

  function openHubWikiAbout() {
    navigate({...obChatSession(), overlay: { type: 'hub-wiki-about' } })
    route = parseRoute()
  }

  function openEmailFromSearch(id: string, subject: string, from: string) {
    inboxTargetId = id
    navigate({...obChatSession(), overlay: { type: 'email', id } })
    route = parseRoute()
    agentContext = { type: 'email', threadId: id, subject, from }
  }

  function openEmailFromChat(threadId: string, subject?: string, from?: string) {
    openEmailFromSearch(threadId, subject ?? '', from ?? '')
  }

  function openEmailDraftFromChat(draftId: string, subject?: string) {
    navigate({
      ...obChatSession(),
      overlay: { type: 'email-draft', id: draftId },
    })
    route = parseRoute()
    agentContext = {
      type: 'email-draft',
      draftId,
      subject: subject?.trim() || loadingSubjectLabel,
      toLine: '',
      bodyPreview: '',
    }
  }

  function openFullInboxFromChat() {
    inboxTargetId = undefined
    navigate({...obChatSession(), overlay: { type: 'email' } })
    route = parseRoute()
  }

  function openMessageThreadFromChat(canonicalChat: string, displayLabel: string) {
    navigate({
      ...obChatSession(),
      overlay: { type: 'messages', chat: canonicalChat },
    })
    route = parseRoute()
    agentContext = { type: 'messages', chat: canonicalChat, displayLabel }
  }

  $effect(() => {
    if (!isSeedingWiki) return
    const t = setInterval(() => {
      void refreshSeedWikiStatus()
    }, 1800)
    return () => clearInterval(t)
  })

  $effect(() => {
    return subscribe((e) => {
      if (e.type === 'wiki:mutated') {
        wikiRefreshKey++
        if (isSeedingWiki) void refreshSeedWikiStatus()
      } else if (e.type === 'sync:completed') {
        calendarRefreshKey++
        wikiRefreshKey++
      }
    })
  })

  $effect(() => {
    const o = route.overlay
    if (o?.type === 'messages' && o.chat) {
      if (agentContext.type !== 'messages' || agentContext.chat !== o.chat) {
        agentContext = {
          type: 'messages',
          chat: o.chat,
          displayLabel: loadingSubjectLabel,
        }
      }
    }
    if (o?.type === 'email-draft' && o.id) {
      if (agentContext.type !== 'email-draft' || agentContext.draftId !== o.id) {
        agentContext = {
          type: 'email-draft',
          draftId: o.id,
          subject: loadingSubjectLabel,
          toLine: '',
          bodyPreview: '',
        }
      }
    }
  })

  function onOpenFromAgent(
    target: { type: string; path?: string; id?: string; date?: string },
    source: AgentOpenSource,
  ) {
    navigateFromAgentOpen(target, {
      source,
      isMobile: !useDesktopSplitDetail,
      openWikiDoc: (path) => openWikiDoc(path),
      openFileDoc: (path) => openFileDoc(path),
      openEmailFromSearch,
      switchToCalendar,
    })
  }

  async function syncAll() {
    syncErrors = []
    showSyncErrors = false
    syncErrors = await runParallelSyncs(fetch)
    emit({ type: 'sync:completed' })
  }

  function onWriteStreaming(p: { path: string; content: string; done: boolean }) {
    if (p.done) {
      wikiWriteStreaming = null
      return
    }
    if (p.path) {
      wikiWriteStreaming = { path: p.path, body: p.content }
    }
  }

  function onEditStreaming(p: { id: string; path: string; done: boolean }) {
    if (p.done) {
      if (wikiEditStreaming?.toolId === p.id) wikiEditStreaming = null
      return
    }
    if (p.path) {
      wikiEditStreaming = { path: wikiPathForReadToolArg(p.path), toolId: p.id }
    }
  }

  function noopSidebar() {
    /* chat history hidden in onboarding */
  }
</script>

{#if showSearch}
  <Search
    onOpenWiki={(path) => {
      openWikiDoc(path)
      showSearch = false
    }}
    onOpenEmail={(id, subject, from) => {
      openEmailFromSearch(id, subject, from)
      showSearch = false
    }}
    onClose={() => {
      showSearch = false
    }}
  />
{/if}

<div class="onboarding-workspace flex h-full min-h-0 flex-1 flex-col">
  <AppTopNav
    showChatHistoryButton={false}
    {isMobile}
    onToggleSidebar={noopSidebar}
    {syncErrors}
    {showSyncErrors}
    onOpenSearch={() => {
      showSearch = true
    }}
    onToggleSyncErrors={() => {
      showSyncErrors = !showSyncErrors
    }}
    onOpenHub={() => {}}
    onNewChat={() => {
      agentChat?.newChat()
    }}
  />

  <div class="ob-ws-main flex min-h-0 flex-1 flex-col" bind:clientWidth={workspaceColumnWidth}>
    <WorkspaceSplit
      bind:this={workspaceSplit}
      workspaceColumnWidthPx={workspaceColumnWidth}
      bind:detailFullscreen={detailPaneFullscreen}
      hasDetail={!!route.overlay}
      desktopDetailOpen={!!route.overlay && useDesktopSplitDetail}
      onNavigateClear={closeOverlayImmediate}
    >
      {#snippet chat()}
        <AgentChat
          bind:this={agentChat}
          context={agentContext}
          conversationHidden={!!route.overlay && !useDesktopSplitDetail}
          hideInput={hideComposerForActivity ||
            (isMobile &&
              !useDesktopSplitDetail &&
              !!route.overlay &&
              !overlaySupportsMobileChatBridge(route.overlay))}
          mobileSlideCoversTranscriptOnly={!hideComposerForActivity &&
            isMobile &&
            !useDesktopSplitDetail &&
            !!route.overlay &&
            overlaySupportsMobileChatBridge(route.overlay)}
          hidePaneContextChip={!!route.overlay && useDesktopSplitDetail}
          suppressAgentDetailAutoOpen={suppressAgentDetailAutoOpen ||
            !useDesktopSplitDetail ||
            hideComposerForActivity}
          {multiTenant}
          {inputPlaceholder}
          autoSendInterviewKickoffHidden={chatEndpoint === '/api/onboarding/interview'}
          conversationView={chatEndpoint === '/api/onboarding/profile'
            ? OnboardingProfilingView
            : chatEndpoint === '/api/onboarding/seed'
              ? OnboardingSeedingView
              : AgentConversation}
          streamingBusyLabel={useOnboardingActivity
            ? chatEndpoint === '/api/onboarding/interview'
              ? $t('onboarding.workspace.streamingBusy.welcome')
              : isProfiling
                ? $t('onboarding.workspace.streamingBusy.profiling')
                : isSeedingWiki
                  ? $t('onboarding.workspace.streamingBusy.seedingWiki')
                  : $t('onboarding.workspace.streamingBusy.working')
            : ''}
          {chatEndpoint}
          {autoSendMessage}
          streamingWritePreview={wikiWriteStreaming}
          {headerFallbackTitle}
          {storageKey}
          onStreamFinished={handleWorkspaceStreamFinished}
          onOpenWiki={openWikiDoc}
          onOpenFile={openFileDoc}
          onOpenEmail={openEmailFromChat}
          onOpenDraft={openEmailDraftFromChat}
          onOpenFullInbox={openFullInboxFromChat}
          onOpenMessageThread={openMessageThreadFromChat}
          onSwitchToCalendar={switchToCalendar}
          {onOpenFromAgent}
          onOpenDraftFromAgent={openEmailDraftFromChat}
          onNewChat={closeOverlay}
          onUserInitiatedNewChat={() => {
            agentChat?.newChat()
          }}
          onAgentFinishConversation={() =>
            chatEndpoint === '/api/onboarding/interview' && onAgentFinishInterview
              ? void onAgentFinishInterview()
              : agentChat?.newChat()}
          onOpenWikiAbout={() => openWikiDoc()}
          onUserSendMessage={closeOverlayOnUserSend}
          {onWriteStreaming}
          {onEditStreaming}
        >
          {#snippet mobileDetail()}
            {#if route.overlay}
              <SlideOver
                bind:this={mobileSlideOver}
                overlay={route.overlay}
                surfaceContext={agentContext}
                {wikiRefreshKey}
                {calendarRefreshKey}
                {inboxTargetId}
                wikiStreamingWrite={wikiWriteStreaming}
                wikiStreamingEdit={wikiEditStreaming}
                {onWikiNavigate}
                onWikiDirNavigate={openWikiDir}
                onInboxNavigate={onInboxNavigateSlide}
                onContextChange={setContext}
                onOpenSearch={() => {
                  showSearch = true
                }}
                {onSummarizeInbox}
                onCalendarResetToToday={resetCalendarToToday}
                onCalendarNavigate={switchToCalendar}
                toolOnOpenFile={openFileDoc}
                toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
                toolOnOpenFullInbox={openFullInboxFromChat}
                toolOnOpenMessageThread={openMessageThreadFromChat}
                onOpenWikiAbout={openHubWikiAbout}
                onClose={closeOverlay}
                mobilePanel
              />
            {/if}
          {/snippet}
        </AgentChat>
      {/snippet}
      {#snippet desktopDetail()}
        {#if route.overlay}
          <SlideOver
            overlay={route.overlay}
            surfaceContext={agentContext}
            {wikiRefreshKey}
            {calendarRefreshKey}
            {inboxTargetId}
            wikiStreamingWrite={wikiWriteStreaming}
            wikiStreamingEdit={wikiEditStreaming}
            {onWikiNavigate}
            onWikiDirNavigate={openWikiDir}
            onInboxNavigate={onInboxNavigateSlide}
            onContextChange={setContext}
            onOpenSearch={() => {
              showSearch = true
            }}
            {onSummarizeInbox}
            onCalendarResetToToday={resetCalendarToToday}
            onCalendarNavigate={switchToCalendar}
            toolOnOpenFile={openFileDoc}
            toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
            toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
            toolOnOpenFullInbox={openFullInboxFromChat}
            toolOnOpenMessageThread={openMessageThreadFromChat}
            onOpenWikiAbout={openHubWikiAbout}
            onClose={closeOverlay}
            detailFullscreen={detailPaneFullscreen}
            onToggleFullscreen={() => workspaceSplit?.toggleDetailFullscreen()}
          />
        {/if}
      {/snippet}
    </WorkspaceSplit>
  </div>
</div>
