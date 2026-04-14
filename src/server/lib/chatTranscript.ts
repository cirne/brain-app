import type { AssistantTurnState, ChatMessage, MessagePart, ToolCall } from './chatTypes.js'

/** Mutable state for one assistant reply (mirrors AgentDrawer SSE handling). */
export function createAssistantTurnState(): AssistantTurnState {
  return { parts: [] }
}

export function applyTextDelta(state: AssistantTurnState, delta: string): void {
  const parts = state.parts
  const last = parts[parts.length - 1]
  if (last?.type === 'text') {
    last.content += delta
  } else {
    parts.push({ type: 'text', content: delta })
  }
}

export function applyThinkingDelta(state: AssistantTurnState, delta: string): void {
  state.thinking = (state.thinking ?? '') + delta
}

export function applyToolStart(state: AssistantTurnState, toolCall: ToolCall): void {
  state.parts.push({ type: 'tool', toolCall: { ...toolCall, done: false } })
}

export function applyToolEnd(
  state: AssistantTurnState,
  id: string,
  result: string,
  isError: boolean | undefined,
  details: unknown | undefined
): void {
  const part = state.parts.find(p => p.type === 'tool' && p.toolCall.id === id) as
    | { type: 'tool'; toolCall: ToolCall }
    | undefined
  if (!part) return
  part.toolCall.result = result
  if (details !== undefined) part.toolCall.details = details
  part.toolCall.isError = isError
  part.toolCall.done = true
}

export function applyStreamError(state: AssistantTurnState, message: string): void {
  state.parts.push({ type: 'text', content: `\n\n**Error:** ${message}` })
}

export function toAssistantMessage(state: AssistantTurnState): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    ...(state.parts.length ? { parts: state.parts.map(clonePart) } : {}),
    ...(state.thinking !== undefined && state.thinking !== '' ? { thinking: state.thinking } : {}),
  }
}

function clonePart(p: MessagePart): MessagePart {
  if (p.type === 'text') return { type: 'text', content: p.content }
  return {
    type: 'tool',
    toolCall: { ...p.toolCall, args: deepCloneArgs(p.toolCall.args) },
  }
}

function deepCloneArgs(args: unknown): unknown {
  if (args === null || typeof args !== 'object') return args
  try {
    return structuredClone(args)
  } catch {
    return args
  }
}
