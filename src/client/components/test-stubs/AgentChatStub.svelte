<script lang="ts">
  import type { SurfaceContext } from '@client/router.js'
  import type { Snippet } from 'svelte'

  let {
    context: _context = { type: 'none' } as SurfaceContext,
    conversationHidden: _conversationHidden = false,
    hideInput: _hideInput = false,
    mobileSlideCoversTranscriptOnly: _mobileSlideCoversTranscriptOnly = false,
    hidePaneContextChip: _hidePaneContextChip = false,
    suppressAgentDetailAutoOpen: _suppressAgentDetailAutoOpen = false,
    onOpenWiki: _onOpenWiki = () => {},
    onOpenFile: _onOpenFile = () => {},
    onOpenEmail: _onOpenEmail = () => {},
    onOpenDraft: _onOpenDraft = () => {},
    onOpenFullInbox: _onOpenFullInbox = () => {},
    onOpenMessageThread: _onOpenMessageThread = () => {},
    onSwitchToCalendar: _onSwitchToCalendar = () => {},
    onOpenFromAgent: _onOpenFromAgent = () => {},
    onOpenDraftFromAgent: _onOpenDraftFromAgent = () => {},
    onNewChat: _onNewChat = () => {},
    onOpenWikiAbout: _onOpenWikiAbout = () => {},
    onAfterDeleteChat: _onAfterDeleteChat = () => {},
    onUserSendMessage: _onUserSendMessage = () => {},
    onSessionChange: _onSessionChange = () => {},
    onStreamingSessionsChange: _onStreamingSessionsChange = () => {},
    onWriteStreaming: _onWriteStreaming = () => {},
    onEditStreaming: _onEditStreaming = () => {},
    mobileDetail,
  }: {
    context?: SurfaceContext
    conversationHidden?: boolean
    hideInput?: boolean
    mobileSlideCoversTranscriptOnly?: boolean
    hidePaneContextChip?: boolean
    suppressAgentDetailAutoOpen?: boolean
    onOpenWiki?: (_path?: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onOpenMessageThread?: (_chat: string, _label: string) => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenFromAgent?: (_target: unknown, _source: unknown) => void
    onOpenDraftFromAgent?: (_draftId: string, _subject?: string) => void
    onNewChat?: () => void
    onOpenWikiAbout?: () => void
    onAfterDeleteChat?: () => void
    onUserSendMessage?: () => void
    onSessionChange?: (_id: string | null, _meta?: { chatTitle?: string | null }) => void
    onStreamingSessionsChange?: (_ids: ReadonlySet<string>) => void
    onWriteStreaming?: (_p: { path: string; content: string; done: boolean }) => void
    onEditStreaming?: (_p: { id: string; path: string; done: boolean }) => void
    mobileDetail?: Snippet
  } = $props()

  export function newChat(_opts?: { skipOverlayClose?: boolean }) {}
  export function loadSession(_id: string): Promise<void> {
    return Promise.resolve()
  }
  export function sendInitialBootstrapKickoff(): Promise<void> {
    return Promise.resolve()
  }
  export function canSendInitialBootstrapKickoff(): boolean {
    return false
  }
  export function getDisplayedLocalSessionKey(): string | null {
    return null
  }
  export function newChatWithMessage(_message: string): Promise<void> {
    return Promise.resolve()
  }
  export function appendToComposer(_text: string) {}
  export function focusComposer() {}
</script>

<div data-testid="agent-chat-stub" class="agent-chat-stub">
  AgentChat
  {#if mobileDetail}
    {@render mobileDetail()}
  {/if}
</div>
