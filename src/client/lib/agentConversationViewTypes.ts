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
  /** Only used by the default chat transcript (empty state override). */
  empty?: Snippet
  /** Onboarding activity transcript only (`OnboardingProfilingView`): profiling vs wiki seeding. */
  onboardingKind?: 'profiling' | 'seeding'
}
