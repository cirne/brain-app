/**
 * Draft lifecycle — new, reply, forward, edit, view.
 * Drafts are stored as JSON under <ripmail_home>/drafts/.
 * For **reply**, callers pass only the new message; this module appends quoted **thread history**
 * from the index: every message in the same `thread_id` from oldest through the message you reply
 * to (standard reply-all-quote behavior, without asking the LLM to reproduce bodies).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureBraintunnelCollaboratorSubject } from '@shared/braintunnelMailMarker.js'
import type { Draft, ReadMailResult } from './types.js'
import type { RipmailDb } from './db.js'
import { listMessageIdsInThreadThrough, readMail } from './mailRead.js'
import { resolveDraftRecipient, resolveDraftRecipients } from './draftRecipient.js'
import { getImapSources, loadRipmailConfig } from './sync/config.js'

type DraftSourceAction = 'reply' | 'forward'

export class DraftSourceMessageNotFoundError extends Error {
  readonly action: DraftSourceAction
  readonly messageId: string

  constructor(action: DraftSourceAction, messageId: string) {
    super(
      `Cannot create ${action} draft: indexed message not found for message_id="${messageId}". Use a messageId from list_inbox, search_index, or read_mail_message and try again.`,
    )
    this.name = 'DraftSourceMessageNotFoundError'
    this.action = action
    this.messageId = messageId
  }
}

function draftsDir(ripmailHome: string): string {
  return join(ripmailHome, 'drafts')
}

function draftPath(ripmailHome: string, draftId: string): string {
  return join(draftsDir(ripmailHome), `${draftId}.json`)
}

function saveDraft(ripmailHome: string, draft: Draft): void {
  mkdirSync(draftsDir(ripmailHome), { recursive: true })
  writeFileSync(draftPath(ripmailHome, draft.id), JSON.stringify(draft, null, 2), 'utf8')
}

function loadDraft(ripmailHome: string, draftId: string): Draft | null {
  const p = draftPath(ripmailHome, draftId)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Draft
  } catch {
    return null
  }
}

export interface NewDraftOptions {
  to: string
  subject: string
  body: string
  /** When true, `[braintunnel]` prefix is ensured on subject (cross-workspace mail). */
  braintunnelCollaborator?: boolean
  sourceId?: string
}

export interface ReplyDraftOptions {
  messageId: string
  /** New reply text only (quoted original is appended from the index). */
  body: string
  subject?: string
  /** Defaults to true. Set false to reply to sender only. */
  replyAll?: boolean
  braintunnelCollaborator?: boolean
  sourceId?: string
}

export interface ForwardDraftOptions {
  messageId: string
  to: string
  body: string
  subject?: string
  braintunnelCollaborator?: boolean
  sourceId?: string
}

export interface EditDraftOptions {
  body?: string
  subject?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  addTo?: string[]
  addCc?: string[]
  addBcc?: string[]
  removeTo?: string[]
  removeCc?: string[]
  removeBcc?: string[]
}

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase()
}

function addUniqueAddress(target: string[], seen: Set<string>, rawAddress: string): void {
  const address = rawAddress.trim()
  if (!address) return
  const key = normalizeAddress(address)
  if (!key || seen.has(key)) return
  seen.add(key)
  target.push(address)
}

function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|tr)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatReplyAttributionLine(original: ReadMailResult): string {
  const dt = new Date(original.date)
  const dateStr = Number.isNaN(dt.getTime())
    ? original.date.trim()
    : dt.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
  const email = original.fromAddress.trim()
  const name = original.fromName?.trim()
  const who = name ? `${name} <${email}>` : email
  return `On ${dateStr}, ${who} wrote:`
}

function quotePlainLines(body: string): string {
  const normalized = body.replace(/\r\n/g, '\n').trimEnd()
  if (!normalized) return '>'
  return normalized
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function resolveQuotedBodyText(original: ReadMailResult): string {
  const plain = (original.bodyText ?? '').trim()
  if (plain) return plain
  const html = original.bodyHtml?.trim()
  if (html) return stripHtmlToPlainText(html)
  return ''
}

/**
 * Builds reply body: new text, then for each indexed message in the thread (oldest → replied-to),
 * a standard "On … wrote:" line and `>`-quoted plaintext. Exported for tests.
 */
function formatForwardDateLine(dateIso: string): string {
  const dt = new Date(dateIso)
  if (Number.isNaN(dt.getTime())) return dateIso.trim()
  return dt.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatForwardFromLine(original: ReadMailResult): string {
  const email = original.fromAddress.trim()
  const name = original.fromName?.trim()
  return name ? `${name} <${email}>` : email
}

function formatAddressList(addrs: string[]): string {
  return addrs.map((a) => a.trim()).filter(Boolean).join(', ')
}

/**
 * Builds forward body: new text, then a standard forwarded-message block from the index.
 * Exported for tests.
 */
export function buildForwardDraftBodyWithQuotedMessage(
  db: RipmailDb,
  newMessageBody: string,
  messageId: string,
): string {
  const top = newMessageBody.trimEnd()
  const msg = readMail(db, messageId, { includeAttachments: false, includeHtml: true })
  if (!msg) return top

  const body = resolveQuotedBodyText(msg)
  const toLine = formatAddressList(msg.toAddresses)
  const ccLine = formatAddressList(msg.ccAddresses)
  const headerLines = [
    '---------- Forwarded message ---------',
    `From: ${formatForwardFromLine(msg)}`,
    `Date: ${formatForwardDateLine(msg.date)}`,
    `Subject: ${msg.subject.trim()}`,
  ]
  if (toLine) headerLines.push(`To: ${toLine}`)
  if (ccLine) headerLines.push(`Cc: ${ccLine}`)
  const forwardedBlock = `${headerLines.join('\n')}\n\n${body.length > 0 ? body : '(no text in original message)'}`
  return `${top}\n\n${forwardedBlock}`
}

export function buildReplyDraftBodyWithQuotedThread(
  db: RipmailDb,
  newMessageBody: string,
  threadId: string,
  throughMessageId: string,
): string {
  const top = newMessageBody.trimEnd()
  let idList = listMessageIdsInThreadThrough(db, threadId, throughMessageId)
  if (idList.length === 0) {
    const one = readMail(db, throughMessageId, { includeAttachments: false, includeHtml: true })
    if (!one) return top
    idList = [throughMessageId]
  }

  const sections: string[] = []
  for (const id of idList) {
    const msg = readMail(db, id, { includeAttachments: false, includeHtml: true })
    if (!msg) continue
    const attribution = formatReplyAttributionLine(msg)
    const raw = resolveQuotedBodyText(msg)
    const quotedBlock = quotePlainLines(raw.length > 0 ? raw : '(no text in original message)')
    sections.push(`${attribution}\n${quotedBlock}`)
  }
  return sections.length > 0 ? `${top}\n\n${sections.join('\n\n')}` : top
}

function resolveMailboxOwnerAddress(
  ripmailHome: string,
  preferredSourceId?: string,
  fallbackSourceId?: string,
): string | undefined {
  const sourceHint = preferredSourceId?.trim() || fallbackSourceId?.trim()
  if (!sourceHint) return undefined
  const config = loadRipmailConfig(ripmailHome)
  const sources = getImapSources(config)
  const source = sources.find((candidate) => candidate.id === sourceHint || candidate.email === sourceHint)
  const email = source?.email?.trim()
  if (email) return email
  return sourceHint.includes('@') ? sourceHint : undefined
}

/**
 * Create a new draft from explicit RFC-style fields.
 */
export function draftNew(db: RipmailDb, ripmailHome: string, opts: NewDraftOptions): Draft {
  const now = new Date().toISOString()
  const subject =
    opts.braintunnelCollaborator === true ? ensureBraintunnelCollaboratorSubject(opts.subject) : opts.subject
  const toResolved = resolveDraftRecipient(db, opts.to)
  const draft: Draft = {
    id: randomUUID(),
    subject,
    body: opts.body,
    to: [toResolved],
    sourceId: opts.sourceId,
    createdAt: now,
    updatedAt: now,
  }
  saveDraft(ripmailHome, draft)
  return draft
}

/**
 * Create a reply draft.
 */
export function draftReply(db: RipmailDb, ripmailHome: string, opts: ReplyDraftOptions): Draft {
  const messageId = opts.messageId.trim()
  const original = readMail(db, messageId, { includeAttachments: false, includeHtml: true })
  if (!original) throw new DraftSourceMessageNotFoundError('reply', messageId)

  const fromAddress = original.fromAddress.trim()
  if (!fromAddress) {
    throw new Error(`Cannot create reply draft: indexed message has no from_address for message_id="${messageId}".`)
  }
  const now = new Date().toISOString()
  const defaultSubject = `Re: ${original.subject}`
  const rawSubject = opts.subject ?? defaultSubject
  const subject =
    opts.braintunnelCollaborator === true ? ensureBraintunnelCollaboratorSubject(rawSubject) : rawSubject
  const replyAll = opts.replyAll !== false
  const ownerAddress = normalizeAddress(
    resolveMailboxOwnerAddress(ripmailHome, opts.sourceId, original.sourceId) ?? '',
  )
  const senderAddress = normalizeAddress(fromAddress)
  const toRecipients: string[] = []
  const toSeen = new Set<string>()
  addUniqueAddress(toRecipients, toSeen, fromAddress)
  const ccRecipients: string[] = []
  const ccSeen = new Set<string>()
  if (replyAll) {
    for (const address of original.toAddresses) {
      const key = normalizeAddress(address)
      if (!key || key === senderAddress || key === ownerAddress) continue
      addUniqueAddress(toRecipients, toSeen, address)
    }
    for (const address of original.ccAddresses) {
      const key = normalizeAddress(address)
      if (!key || key === senderAddress || key === ownerAddress || toSeen.has(key)) continue
      addUniqueAddress(ccRecipients, ccSeen, address)
    }
  }
  const fullBody = buildReplyDraftBodyWithQuotedThread(db, opts.body, original.threadId, original.messageId)
  const draft: Draft = {
    id: randomUUID(),
    subject,
    body: fullBody,
    to: toRecipients,
    ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
    inReplyToMessageId: original.messageId,
    sourceId: opts.sourceId,
    createdAt: now,
    updatedAt: now,
  }
  saveDraft(ripmailHome, draft)
  return draft
}

/**
 * Create a forward draft.
 */
export function draftForward(db: RipmailDb, ripmailHome: string, opts: ForwardDraftOptions): Draft {
  const messageId = opts.messageId.trim()
  const original = readMail(db, messageId, { includeAttachments: false, includeHtml: true })
  if (!original) throw new DraftSourceMessageNotFoundError('forward', messageId)

  const now = new Date().toISOString()
  const defaultSubject = `Fwd: ${original.subject}`
  const rawSubject = opts.subject ?? defaultSubject
  const subject =
    opts.braintunnelCollaborator === true ? ensureBraintunnelCollaboratorSubject(rawSubject) : rawSubject
  const toResolved = resolveDraftRecipient(db, opts.to)
  const fullBody = buildForwardDraftBodyWithQuotedMessage(db, opts.body, original.messageId)
  const draft: Draft = {
    id: randomUUID(),
    subject,
    body: fullBody,
    to: [toResolved],
    forwardMessageId: original.messageId,
    sourceId: opts.sourceId,
    createdAt: now,
    updatedAt: now,
  }
  saveDraft(ripmailHome, draft)
  return draft
}

/**
 * Edit an existing draft.
 */
export function draftEdit(db: RipmailDb, ripmailHome: string, draftId: string, opts: EditDraftOptions): Draft {
  const draft = loadDraft(ripmailHome, draftId)
  if (!draft) throw new Error(`Draft not found: ${draftId}`)
  const now = new Date().toISOString()

  function applyRecipientEdits(
    current: string[] | undefined,
    replace?: string[],
    add?: string[],
    remove?: string[],
  ): string[] | undefined {
    let result = replace ?? current ?? []
    if (add?.length) result = [...result, ...add]
    if (remove?.length) {
      const removeSet = new Set(remove.map((s) => s.toLowerCase()))
      result = result.filter((r) => !removeSet.has(r.toLowerCase()))
    }
    return result.length > 0 ? result : undefined
  }

  function resolveList(list: string[] | undefined): string[] | undefined {
    if (!list?.length) return undefined
    return resolveDraftRecipients(db, list)
  }

  const toNext = applyRecipientEdits(draft.to, opts.to, opts.addTo, opts.removeTo)
  const ccNext = applyRecipientEdits(draft.cc, opts.cc, opts.addCc, opts.removeCc)
  const bccNext = applyRecipientEdits(draft.bcc, opts.bcc, opts.addBcc, opts.removeBcc)

  const updated: Draft = {
    ...draft,
    subject: opts.subject ?? draft.subject,
    to: resolveList(toNext),
    cc: resolveList(ccNext),
    bcc: resolveList(bccNext),
    body: opts.body !== undefined ? opts.body : draft.body,
    updatedAt: now,
  }
  saveDraft(ripmailHome, updated)
  return updated
}

/**
 * View a draft.
 */
export function draftView(ripmailHome: string, draftId: string): Draft | null {
  return loadDraft(ripmailHome, draftId)
}

/**
 * List all drafts.
 */
export function draftList(ripmailHome: string): Draft[] {
  const dir = draftsDir(ripmailHome)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8')) as Draft
      } catch {
        return null
      }
    })
    .filter((d): d is Draft => d != null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Remove a draft file from disk.
 */
export function draftDelete(ripmailHome: string, draftId: string): void {
  const p = draftPath(ripmailHome, draftId)
  if (!existsSync(p)) throw new Error(`Draft not found: ${draftId}`)
  unlinkSync(p)
}
