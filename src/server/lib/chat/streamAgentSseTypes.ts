/**
 * Wire-format payloads and helpers for `streamAgentSse` (pi-agent event handling).
 * Kept in a separate module so `streamAgentSse.ts` can focus on stream lifecycle and SSE.
 */

/** Loosely typed pi-agent subscribe payloads (not exported from core). */
export interface MessageUpdatePayload {
  assistantMessageEvent?: {
    type?: string
    delta?: string
  }
  message?: unknown
}

export interface ToolExecutionStartPayload {
  toolCallId: string
  toolName: string
  args: unknown
}

export interface ToolContentPart {
  type?: string
  text?: string
}

export interface ToolExecutionEndPayload {
  toolCallId: string
  toolName: string
  isError?: boolean
  result?: {
    content?: ToolContentPart[]
    details?: unknown
  }
}

export function toolResultText(ev: ToolExecutionEndPayload): string {
  const parts = ev.result?.content
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((c): c is ToolContentPart & { text: string } => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join('')
}
