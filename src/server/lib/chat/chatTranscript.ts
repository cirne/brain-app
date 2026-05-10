import { randomUUID } from 'node:crypto'
import type { AssistantTurnState, ChatMessage, MessagePart, ToolCall } from './chatTypes.js'

/** Mutable state for one assistant reply (mirrors AgentChat / agentStream SSE handling). */
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

/** Parsed tool calls from pi-agent `message_update` partial assistant message (toolCall blocks). */
export function extractStreamingToolCallsFromPartialAssistant(
  partial: unknown
): Array<{ id: string; name: string; args: unknown }> {
  if (!partial || typeof partial !== 'object') return []
  const content = (partial as { content?: unknown }).content
  if (!Array.isArray(content)) return []
  const out: Array<{ id: string; name: string; args: unknown }> = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if ((block as { type?: string }).type !== 'toolCall') continue
    const id = (block as { id?: unknown }).id
    const name = (block as { name?: unknown }).name
    const args = (block as { arguments?: unknown }).arguments
    if (typeof id === 'string' && typeof name === 'string') {
      out.push({ id, name, args: args ?? {} })
    }
  }
  return out
}

/** Insert or update a tool row by id (streaming tool args before tool_execution_start). */
export function applyToolArgsUpsert(state: AssistantTurnState, toolCall: ToolCall): void {
  const part = state.parts.find(p => p.type === 'tool' && p.toolCall.id === toolCall.id) as
    | { type: 'tool'; toolCall: ToolCall }
    | undefined
  if (!part) {
    state.parts.push({ type: 'tool', toolCall: { ...toolCall, done: false } })
    return
  }
  part.toolCall.name = toolCall.name
  part.toolCall.args = toolCall.args
}

export function applyToolStart(state: AssistantTurnState, toolCall: ToolCall): void {
  applyToolArgsUpsert(state, toolCall)
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
    id: randomUUID(),
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
