import type { MessagePart, ToolPart } from '../agentUtils.js'
import type { ChatToolDisplayMode } from '../chatToolDisplayPreference.js'
import { getToolDefinitionCore } from '../tools/registryCore.js'

function showsInChat(name: string): boolean {
  return getToolDefinitionCore(name).chat.showInChat
}

function isStickyTool(toolCall: ToolPart['toolCall']): boolean {
  if (toolCall.isError) return true
  return getToolDefinitionCore(toolCall.name).chat.stickyInTranscript === true
}

/**
 * Presentation-only: in **Focused** mode, consecutive non-sticky tool parts collapse to the last
 * in each segment (split by sticky tools or by preceding logic in the caller — here we only walk tools).
 */
export function expandPartsForToolDisplay(
  parts: MessagePart[] | undefined,
  toolDisplayMode: ChatToolDisplayMode,
  role: 'user' | 'assistant',
): MessagePart[] {
  if (!parts?.length) return parts ? [...parts] : []
  if (toolDisplayMode !== 'focused' || role !== 'assistant') return [...parts]

  const out: MessagePart[] = []
  let i = 0
  while (i < parts.length) {
    const p = parts[i]
    if (p.type !== 'tool') {
      out.push(p)
      i++
      continue
    }
    if (!showsInChat(p.toolCall.name)) {
      out.push(p)
      i++
      continue
    }
    const run: ToolPart[] = []
    while (
      i < parts.length &&
      parts[i].type === 'tool' &&
      showsInChat((parts[i] as ToolPart).toolCall.name)
    ) {
      run.push(parts[i] as ToolPart)
      i++
    }
    let segStart = 0
    for (let j = 0; j < run.length; j++) {
      if (!isStickyTool(run[j].toolCall)) continue
      if (j > segStart) {
        out.push(run[j - 1])
      }
      out.push(run[j])
      segStart = j + 1
    }
    if (segStart < run.length) {
      out.push(run[run.length - 1])
    }
  }
  return out
}
