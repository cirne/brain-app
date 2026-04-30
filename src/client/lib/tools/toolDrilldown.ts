import type { ToolCall } from '../agentUtils.js'
import type { ContentCardPreview } from '../cards/contentCards.js'
import { matchContentPreview } from './matchPreview.js'
import { wikiOpenPathFromArgs } from './toolArgSummary.js'

export type ToolDrilldown =
  | { kind: 'wiki'; path: string }
  | { kind: 'file'; path: string }
  | { kind: 'email'; id: string; subject: string; from: string }
  | { kind: 'email_draft'; draftId: string; subject: string }
  | { kind: 'calendar'; date: string; eventId?: string }
  | { kind: 'message_thread'; canonicalChat: string; displayLabel: string }
  | { kind: 'inbox' }
  | { kind: 'mail_search'; preview: Extract<ContentCardPreview, { kind: 'mail_search_hits' }> }

function datePart(value: string | undefined): string | null {
  const t = value?.trim()
  if (!t) return null
  return t.slice(0, 10)
}

export function toolDrilldownForTool(
  tool: ToolCall,
  preview: ContentCardPreview | null = matchContentPreview(tool),
): ToolDrilldown | null {
  if (!tool.done || tool.isError) return null

  if (preview) {
    switch (preview.kind) {
      case 'wiki':
      case 'wiki_edit_diff':
        return { kind: 'wiki', path: preview.path }
      case 'file':
        return { kind: 'file', path: preview.path }
      case 'email':
        return { kind: 'email', id: preview.id, subject: preview.subject, from: preview.from }
      case 'email_draft':
        return { kind: 'email_draft', draftId: preview.draftId, subject: preview.subject }
      case 'calendar': {
        const firstEvent = preview.events[0]
        const date = datePart(firstEvent?.start) ?? datePart(preview.start)
        if (!date) return null
        return {
          kind: 'calendar',
          date,
          ...(firstEvent?.id ? { eventId: firstEvent.id } : {}),
        }
      }
      case 'message_thread':
        return {
          kind: 'message_thread',
          canonicalChat: preview.canonicalChat,
          displayLabel: preview.displayChat,
        }
      case 'inbox_list':
        return { kind: 'inbox' }
      case 'mail_search_hits':
        return { kind: 'mail_search', preview }
      default:
        return null
    }
  }

  if (tool.name === 'list_inbox') {
    return { kind: 'inbox' }
  }

  const path = wikiOpenPathFromArgs(tool.name, tool.args)
  return path ? { kind: 'wiki', path } : null
}
