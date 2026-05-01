import { formatEmailParticipant } from './ripmailInboxFlatten.js'

/** Fields extracted from `ripmail read --json` (thread or single message). */
export function pickReadEmailFields(j: Record<string, unknown>): { subject: string; from: string; body: string } {
  let subject = typeof j.subject === 'string' ? j.subject : ''
  let fromVal: unknown = j.from
  let body = typeof j.body === 'string' ? j.body : ''

  if (Array.isArray(j.messages) && j.messages.length > 0) {
    const m0 = j.messages[0] as Record<string, unknown>
    if (!subject && typeof m0.subject === 'string') subject = m0.subject
    if (fromVal == null && m0.from != null) fromVal = m0.from
    if (!body && typeof m0.body === 'string') body = m0.body
  }

  return {
    subject: subject || '(no subject)',
    from: formatEmailParticipant(fromVal),
    body,
  }
}

/** Stored on `tool.details` when **`read_mail_message`** completes — survives 4k result truncation in SSE. */
export type ReadEmailToolDetails = {
  readEmailPreview: true
  id: string
  subject: string
  from: string
  snippet: string
}

/** Stored on `tool.details` when **`read_indexed_file`** completes (Drive / localDir frontmatter reads). */
export type ReadFileToolDetails = {
  readFilePreview: true
  id: string
  sourceKind: string
  title: string
  excerpt: string
}

export function buildReadEmailPreviewDetails(parsed: Record<string, unknown>, messageId: string): ReadEmailToolDetails {
  const { subject, from, body } = pickReadEmailFields(parsed)
  const flat = body.replace(/\s+/g, ' ').trim()
  const snippet = flat.slice(0, 200) + (flat.length > 200 ? '…' : '')
  return {
    readEmailPreview: true,
    id: messageId,
    subject,
    from,
    snippet,
  }
}

/**
 * Ripmail prefixes extracted PDF and similar text with `## filename` before the body.
 * Use when YAML metadata is missing or the UI only has flattened excerpt text (newlines collapsed).
 */
export function extractRipmailIndexedMarkdownTitle(fullText: string): string | null {
  const t = fullText.trimStart()
  const lineHeading = /^##\s+([^\r\n]+)/.exec(t)
  if (lineHeading?.[1]) {
    let raw = lineHeading[1].trim()
    if (!raw) return null
    const withTrailingWord = /^(\S+\.[A-Za-z][A-Za-z0-9]{0,14})\s+\S/.exec(raw)
    if (withTrailingWord?.[1]) return withTrailingWord[1]
    const filenameOnly = /^(\S+\.[A-Za-z][A-Za-z0-9]{0,14})$/.exec(raw)
    if (filenameOnly?.[1]) return filenameOnly[1]
    return raw
  }
  const oneLine = t.replace(/\s+/g, ' ').trim()
  const flatHeading = /^##\s+(\S+)/.exec(oneLine)
  if (flatHeading?.[1]) return flatHeading[1]
  return null
}
