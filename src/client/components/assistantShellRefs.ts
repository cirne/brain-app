import type AgentChat from './AgentChat.svelte'
import type AssistantSlideOver from './AssistantSlideOver.svelte'
import type WorkspaceSplit from './WorkspaceSplit.svelte'

/** `bind:this` targets — kept separate from {@link createAssistantShellState} data so refs stay obvious. */
export type AssistantRefsState = {
  agentChat?: AgentChat
  mobileSlideOver?: AssistantSlideOver
  workspaceSplit?: WorkspaceSplit
  chatHistory?: { refresh: (_opts?: { background?: boolean }) => Promise<void> }
}

export function emptyAssistantRefs(): AssistantRefsState {
  return {}
}
