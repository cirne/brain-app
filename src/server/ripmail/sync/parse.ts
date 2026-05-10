/**
 * Parse a raw .eml file into a DB row structure.
 * Uses the `mailparser` npm package.
 */

import { simpleParser } from 'mailparser'

export interface ParsedMessage {
  messageId: string
  threadId: string
  folder: string
  uid: number
  labels: string[]
  category?: string
  fromAddress: string
  fromName?: string
  toAddresses: string[]
  ccAddresses: string[]
  toRecipients: string[]
  ccRecipients: string[]
  subject: string
  date: string
  bodyText: string
  bodyHtml?: string
  rawPath: string
  sourceId: string
  attachments: Array<{
    filename: string
    mimeType: string
    size: number
    storedPath: string
    content?: Buffer
  }>
}

/** Parse a raw EML buffer into a structured message. */
export async function parseEml(
  raw: Buffer | string,
  rawPath: string,
  opts: { folder: string; uid: number; sourceId: string; labels?: string[]; category?: string },
): Promise<ParsedMessage> {
  const buf = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw
  const parsed = await simpleParser(buf, {
    skipHtmlToText: false,
    skipTextToHtml: false,
    skipImageLinks: true,
  })

  const fromAddr = parsed.from?.value?.[0]?.address ?? ''
  const fromName = parsed.from?.value?.[0]?.name || undefined

  const toAddresses = (parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : [])
    .flatMap((a) => a.value.map((v) => v.address ?? ''))
    .filter(Boolean)

  const ccAddresses = (parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]) : [])
    .flatMap((a) => a.value.map((v) => v.address ?? ''))
    .filter(Boolean)

  const toRecipients = (parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : [])
    .flatMap((a) =>
      a.value.map((v) => v.name ? `${v.name} <${v.address}>` : v.address ?? '')
    )
    .filter(Boolean)

  const ccRecipients = (parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]) : [])
    .flatMap((a) =>
      a.value.map((v) => v.name ? `${v.name} <${v.address}>` : v.address ?? '')
    )
    .filter(Boolean)

  const messageId = parsed.messageId
    ? (parsed.messageId.startsWith('<') ? parsed.messageId.slice(1, -1) : parsed.messageId)
    : `${opts.uid}-${opts.sourceId}`

  // Thread ID: use In-Reply-To header if present, else use message ID as root
  const inReplyTo = parsed.inReplyTo
  const threadId = inReplyTo
    ? (inReplyTo.startsWith('<') ? inReplyTo.slice(1, -1) : inReplyTo)
    : messageId

  const bodyText = parsed.text ?? ''
  const bodyHtml = parsed.html || undefined

  const date = parsed.date ? parsed.date.toISOString() : new Date().toISOString()

  const attachments = (parsed.attachments ?? [])
    .filter((a) => a.filename && a.contentType !== 'text/plain' && a.contentType !== 'text/html')
    .map((a) => ({
      filename: a.filename ?? 'attachment',
      mimeType: a.contentType ?? 'application/octet-stream',
      size: a.size,
      storedPath: '',
      content: a.content,
    }))

  return {
    messageId,
    threadId,
    folder: opts.folder,
    uid: opts.uid,
    labels: opts.labels ?? [],
    category: opts.category,
    fromAddress: fromAddr,
    fromName,
    toAddresses,
    ccAddresses,
    toRecipients,
    ccRecipients,
    subject: parsed.subject ?? '',
    date,
    bodyText,
    bodyHtml,
    rawPath,
    sourceId: opts.sourceId,
    attachments,
  }
}
