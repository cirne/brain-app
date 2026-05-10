import { createBaseTurndownService } from '@shared/turndownBrainBase.js'

/** Convert HTML email bodies / mammoth output into Markdown for agent context. */
export function htmlToAgentMarkdown(html: string): string {
  const trimmed = html.trim()
  if (!trimmed) return ''
  const td = createBaseTurndownService()
  return td.turndown(trimmed).trim()
}
