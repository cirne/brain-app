import type { Snippet } from 'svelte'
import type { ChatMessage } from './agentUtils.js'
import type { ChatToolDisplayMode } from './chatToolDisplayPreference.js'
import type { ContentCardPreview } from './cards/contentCards.js'
import type { NotificationPresentation } from '@shared/notifications/presentation.js'

/** Overrides for transcript row headers (solo chat defaults to You / Assistant). */
export type ConversationRoleLabels = {
  userLabel: string
  assistantLabel: string
  assistantWorkingAria: string
}

/** Empty-chat notification strip: mapped rows + handlers (see {@link NotificationPresentation}). */
export type EmptyChatNotificationsProps = {
  items: NotificationPresentation[]
  hasMore: boolean
  onAct: (_row: NotificationPresentation) => void
  onDismiss: (_id: string) => void
}

/**
 * Scroll API exposed by conversation UIs bound to AgentChat (`bind:this`).
 * Any alternate agent view (profiling, wiki cleanup, …) must implement this so SSE
 * streaming can scroll the pane the same way as {@link AgentConversation}.
 */
export type ConversationScrollApi = {
  scrollToBottom: () => void
  scrollToBottomIfFollowing: () => void
}

/**
 * Props for the main transcript area. The default implementation is
 * {@link AgentConversation}; specialized agents pass a different component
 * with the same contract + {@link ConversationScrollApi} on the instance.
 */
export type AgentConversationViewProps = {
  messages: ChatMessage[]
  streaming: boolean
  onOpenWiki?: (_path: string) => void
  onOpenFile?: (_path: string) => void
  onOpenIndexedFile?: (_id: string, _source?: string) => void
  onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
  onOpenDraft?: (_draftId: string, _subject?: string) => void
  onOpenFullInbox?: () => void
  onSwitchToCalendar?: (_date: string, _eventId?: string) => void
  onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
  onOpenMailSearchResults?: (
    _preview: Extract<ContentCardPreview, { kind: 'mail_search_hits' }>,
    _sourceId: string,
  ) => void
  onOpenVisualArtifact?: (_ref: string, _label?: string) => void
  /** Empty-state “your wiki” link → wiki vault landing (same as Wiki in the top bar). */
  onOpenWikiAbout?: () => void
  /** Tunnel / inbound threads: localized labels instead of generic You / Assistant. */
  conversationRoleLabels?: ConversationRoleLabels
  /**
   * Outbound brain-to-brain tunnel: alternate empty transcript copy (you're messaging someone else's Brain).
   */
  tunnelOutboundEmptyChat?: boolean
  /** Workspace @handle (or rare display-only fallback); when absent, tunnel empty-state uses anonymous strings. */
  tunnelOutboundPeer?: string | null
  /** Only used by the default chat transcript (empty state override). */
  empty?: Snippet
  /**
   * Live `write` tool body for onboarding (e.g. `me.md` while profiling) — same shape as {@link Wiki}'s `streamingWrite`.
   */
  streamingWrite?: { path: string; body: string } | null
  /** Hosted multi-tenant onboarding: alternate lead copy in profiling transcript. */
  multiTenant?: boolean
  /**
   * Tool rows in the transcript: compact (default) vs detailed (expandable args and results).
   * Used by the default transcript only; onboarding views ignore this prop.
   */
  toolDisplayMode?: ChatToolDisplayMode
}
