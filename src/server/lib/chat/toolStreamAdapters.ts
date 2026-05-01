import type { AssistantTurnState } from './chatTypes.js'
import { buildReadEmailPreviewDetails } from '@shared/readEmailPreview.js'

/**
 * Pure shaping for **`read_mail_message`** / **`read_indexed_file`** tool_end `details` (no I/O, no NR).
 * Returns `undefined` if the payload should be left to runtime defaults.
 */
export function shapeReadEmailStreamDetails(
  resultText: string,
  toolCallId: string,
  assistantState: AssistantTurnState,
): unknown | undefined {
  if (!resultText.trim().startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(resultText) as Record<string, unknown>
    const partBefore = assistantState.parts.find(
      (p) => p.type === 'tool' && p.toolCall.id === toolCallId,
    ) as { type: 'tool'; toolCall: { args: unknown } } | undefined
    const argsObj = partBefore?.toolCall.args
    const aid =
      argsObj != null &&
      typeof argsObj === 'object' &&
      typeof (argsObj as { id?: unknown }).id === 'string'
        ? (argsObj as { id: string }).id
        : ''
    return buildReadEmailPreviewDetails(parsed, aid)
  } catch {
    return undefined
  }
}
