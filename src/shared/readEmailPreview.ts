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

/** Stored on `tool.details` when **`read_mail_message`** or **`read_indexed_file`** completes — survives 4k result truncation in SSE. */
export type ReadEmailToolDetails = {
  readEmailPreview: true
  id: string
  subject: string
  from: string
  snippet: string
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
