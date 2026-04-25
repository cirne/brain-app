import type { Snippet } from 'svelte'
import type { ChatMessage } from './agentUtils.js'

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
  onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
  onOpenFullInbox?: () => void
  onSwitchToCalendar?: (_date: string, _eventId?: string) => void
  onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
  /** When the assistant uses **suggest_reply_options**, chip taps submit this as the next user message. */
  onSubmitQuickReply?: (_text: string) => void
  /** Empty-state “your wiki” link → `hub-wiki-about` overlay (chat / hub / SlideOver). */
  onOpenWikiAbout?: () => void
  /** Only used by the default chat transcript (empty state override). */
  empty?: Snippet
  /**
   * Live `write` tool body for onboarding (e.g. `me.md` while profiling) — same shape as {@link Wiki}'s `streamingWrite`.
   */
  streamingWrite?: { path: string; body: string } | null
  /** Hosted multi-tenant onboarding: alternate lead copy in profiling transcript. */
  multiTenant?: boolean
}
