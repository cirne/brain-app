/**
 * readMail() and readIndexedFile() — mirrors ripmail/src/mail_read.rs.
 */

import { readFileSync } from 'node:fs'
import type { RipmailDb } from './db.js'
import type {
  ReadMailResult,
  ReadMailDisplayResult,
  ReadIndexedFileResult,
  AttachmentMeta,
} from './types.js'
import {
  visualArtifactsFromAttachments,
  visualArtifactFromIndexedFileResult,
} from './visualArtifacts.js'
import { readGoogleDriveFileBodyCached } from './sync/googleDriveReadBody.js'
import { htmlToAgentMarkdown } from '../lib/htmlToAgentMarkdown.js'

interface MessageRow {
  message_id: string
  thread_id: string
  source_id: string
  from_address: string
  from_name: string | null
  to_addresses: string
  cc_addresses: string
  subject: string
  date: string
  body_text: string
  body_html: string | null
  raw_path: string
  is_archived: number
  category: string | null
}

interface AttachmentRow {
  id: number
  filename: string
  mime_type: string
  size: number
  extracted_text: string | null
}

function parseJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function modifiedAtFromDocumentIndex(dateIso: unknown): string | undefined {
  if (typeof dateIso !== 'string') return undefined
  const s = dateIso.trim()
  return s.length > 0 ? s : undefined
}

function modifiedAtFromFileMtime(mtime: unknown): string | undefined {
  if (typeof mtime !== 'number' || !Number.isFinite(mtime)) return undefined
  const ms = mtime > 1e12 ? mtime : mtime * 1000
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

function listAttachments(db: RipmailDb, messageId: string): AttachmentMeta[] {
  // Try both with and without angle brackets for message_id
  const resolvedId = resolveMessageId(db, messageId) ?? messageId
  const rows = db
    .prepare(
      `SELECT id, filename, mime_type, size, extracted_text
       FROM attachments WHERE message_id = ? ORDER BY id`,
    )
    .all(resolvedId) as AttachmentRow[]
  return rows.map((r, i) => ({
    id: r.id,
    filename: r.filename,
    mimeType: r.mime_type,
    size: r.size,
    extracted: r.extracted_text != null,
    index: i + 1,
  }))
}

/**
 * Read a mail message by its Message-ID.
 * Returns structured metadata + body text + attachment list.
 */
/**
 * Canonicalize a message ID: the Rust ripmail stores IDs with angle brackets.
 * Try the ID as-is first, then with brackets, then without.
 */
function resolveMessageId(db: RipmailDb, messageId: string): string | null {
  const stmt = db.prepare(`SELECT message_id FROM messages WHERE message_id = ? LIMIT 1`)
  // 1. Try as-is
  const raw = stmt.get(messageId) as { message_id: string } | undefined
  if (raw) return raw.message_id
  // 2. Try with angle brackets
  if (!messageId.startsWith('<')) {
    const bracketed = `<${messageId}>`
    const br = stmt.get(bracketed) as { message_id: string } | undefined
    if (br) return br.message_id
  }
  // 3. Try without angle brackets
  if (messageId.startsWith('<') && messageId.endsWith('>')) {
    const bare = messageId.slice(1, -1)
    const nb = stmt.get(bare) as { message_id: string } | undefined
    if (nb) return nb.message_id
  }
  return null
}

function bareMessageIdForCompare(stored: string): string {
  const t = stored.trim()
  return t.startsWith('<') && t.endsWith('>') ? t.slice(1, -1).trim() : t
}

/**
 * Stored `message_id` values for one mail thread in chronological order (oldest → newest), through
 * `throughMessageId` inclusive. Used when composing reply bodies with standard quoted history.
 */
export function listMessageIdsInThreadThrough(
  db: RipmailDb,
  threadId: string,
  throughMessageId: string,
): string[] {
  const resolvedThrough = resolveMessageId(db, throughMessageId)
  if (!resolvedThrough) return []
  const throughBare = bareMessageIdForCompare(resolvedThrough)

  const rows = db
    .prepare(
      `SELECT message_id FROM messages WHERE thread_id = ? ORDER BY date ASC, message_id ASC`,
    )
    .all(threadId) as Array<{ message_id: string }>

  if (rows.length === 0) return []

  const bareList = rows.map((r) => bareMessageIdForCompare(r.message_id))
  const idx = bareList.findIndex((b) => b === throughBare)
  if (idx < 0) return []
  return rows.slice(0, idx + 1).map((r) => r.message_id)
}

export function readMail(
  db: RipmailDb,
  messageId: string,
  opts?: { plainBody?: boolean; fullBody?: boolean; includeAttachments?: boolean; includeHtml?: boolean },
): ReadMailResult | null {
  const resolvedId = resolveMessageId(db, messageId)
  if (!resolvedId) return null

  const row = db
    .prepare(
      `SELECT message_id, thread_id, source_id, from_address, from_name,
              to_addresses, cc_addresses, subject, date, body_text, body_html,
              raw_path, is_archived, category
       FROM messages WHERE message_id = ?`,
    )
    .get(resolvedId) as MessageRow | undefined

  if (!row) return null

  // Normalize messageId: strip angle brackets to match Rust CLI output shape
  const normalizedMessageId = row.message_id.startsWith('<') && row.message_id.endsWith('>')
    ? row.message_id.slice(1, -1)
    : row.message_id
  const attachments = opts?.includeAttachments !== false ? listAttachments(db, row.message_id) : undefined
  const visualArtifacts = visualArtifactsFromAttachments(normalizedMessageId, attachments)
  const enrichedAttachments =
    attachments && visualArtifacts.length > 0
      ? attachments.map((attachment) => {
          const visualArtifact = visualArtifacts.find(
            (artifact) =>
              artifact.origin.kind === 'mailAttachment' &&
              artifact.origin.attachmentIndex === attachment.index,
          )
          return visualArtifact ? { ...attachment, visualArtifact } : attachment
        })
      : attachments

  let bodyText: string | undefined = row.body_text ?? undefined
  if (opts?.plainBody === false) {
    bodyText = undefined
  } else if (!(bodyText ?? '').trim() && row.body_html?.trim()) {
    bodyText = htmlToAgentMarkdown(row.body_html)
  }
  const bodyHtml = opts?.includeHtml && row.body_html?.trim() ? row.body_html : undefined

  return {
    messageId: normalizedMessageId,
    threadId: row.thread_id,
    sourceId: row.source_id,
    fromAddress: row.from_address,
    fromName: row.from_name ?? undefined,
    toAddresses: parseJsonArray(row.to_addresses),
    ccAddresses: parseJsonArray(row.cc_addresses),
    subject: row.subject,
    date: row.date,
    bodyText,
    bodyHtml,
    rawPath: row.raw_path,
    isArchived: row.is_archived === 1,
    category: row.category ?? undefined,
    attachments: enrichedAttachments,
    ...(visualArtifacts.length > 0 ? { visualArtifacts } : {}),
  }
}

/**
 * UI-only message read: keeps agent reads text-only while allowing the inbox panel to render
 * the original HTML MIME part stored during sync.
 */
export function readMailForDisplay(
  db: RipmailDb,
  _ripmailHome: string,
  messageId: string,
): ReadMailDisplayResult | null {
  const msg = readMail(db, messageId, { includeAttachments: true, includeHtml: true })
  if (!msg) return null

  return {
    messageId: msg.messageId,
    threadId: msg.threadId,
    sourceId: msg.sourceId,
    fromAddress: msg.fromAddress,
    ...(msg.fromName ? { fromName: msg.fromName } : {}),
    toAddresses: msg.toAddresses,
    ccAddresses: msg.ccAddresses,
    subject: msg.subject,
    date: msg.date,
    rawPath: msg.rawPath,
    isArchived: msg.isArchived,
    ...(msg.category ? { category: msg.category } : {}),
    bodyKind: msg.bodyHtml ? 'html' : 'text',
    bodyText: msg.bodyText ?? '',
    ...(msg.bodyHtml ? { bodyHtml: msg.bodyHtml } : {}),
    ...(msg.visualArtifacts?.length ? { visualArtifacts: msg.visualArtifacts } : {}),
  }
}

/**
 * Read an indexed file (Drive, localDir) by its ID/path.
 * When `opts.fullBody` is true for Google Drive, fetches authoritative content from the API (metadata check + fingerprint-validated disk cache).
 * When `opts.sourceId` is set, matches that ripmail source (same as search_index `source`).
 */
export async function readIndexedFile(
  db: RipmailDb,
  ripmailHome: string,
  id: string,
  opts?: { fullBody?: boolean; sourceId?: string },
): Promise<ReadIndexedFileResult | null> {
  const wantSource = opts?.sourceId?.trim() || undefined

  // Drive: document_index entry with ext_id = id
  const diRow = wantSource
    ? (db
        .prepare(
          `SELECT di.ext_id, di.source_id, di.title, di.body, di.kind, di.mime, di.date_iso, s.kind AS source_kind
           FROM document_index di
           LEFT JOIN sources s ON s.id = di.source_id
           WHERE di.ext_id = ? AND di.source_id = ? AND di.kind IN ('googleDrive', 'file')
           LIMIT 1`,
        )
        .get(id, wantSource) as Record<string, unknown> | undefined)
    : (db
        .prepare(
          `SELECT di.ext_id, di.source_id, di.title, di.body, di.kind, di.mime, di.date_iso, s.kind AS source_kind
           FROM document_index di
           LEFT JOIN sources s ON s.id = di.source_id
           WHERE di.ext_id = ? AND di.kind IN ('googleDrive', 'file')
           LIMIT 1`,
        )
        .get(id) as Record<string, unknown> | undefined)

  if (diRow) {
    const rowKind = String(diRow['kind'] ?? '')
    const sourceId = String(diRow['source_id'] ?? '')
    const extId = String(diRow['ext_id'] ?? id)
    const docModifiedAt = modifiedAtFromDocumentIndex(diRow['date_iso'])
    if (rowKind === 'googleDrive' && opts?.fullBody && ripmailHome) {
      const fetched = await readGoogleDriveFileBodyCached(ripmailHome, sourceId, extId)
      if (fetched) {
        const result: ReadIndexedFileResult = {
          id: extId,
          sourceKind: 'googleDrive',
          title: fetched.title,
          bodyText: fetched.text,
          mime: fetched.mime,
          ...(docModifiedAt ? { modifiedAt: docModifiedAt } : {}),
        }
        const visualArtifacts = visualArtifactFromIndexedFileResult(result)
        return visualArtifacts.length > 0 ? { ...result, visualArtifacts } : result
      }
      const indexedOnly = String(diRow['body'] ?? '')
      if (!indexedOnly.trim()) {
        throw new Error(
          'Google Drive full read failed (live export empty or unavailable, and the index has no body text). Try refresh_sources, confirm OAuth, or check file permissions.',
        )
      }
    }

    const body = String(diRow['body'] ?? '')
    const maxChars = opts?.fullBody ? Infinity : 4000
    const mimeFromIndex =
      typeof diRow['mime'] === 'string' && diRow['mime'].trim() ? String(diRow['mime']).trim() : undefined
    const result: ReadIndexedFileResult = {
      id: extId,
      sourceKind: String(diRow['source_kind'] ?? rowKind ?? ''),
      title: String(diRow['title'] ?? ''),
      bodyText: body.slice(0, maxChars),
      ...(mimeFromIndex ? { mime: mimeFromIndex } : {}),
      ...(docModifiedAt ? { modifiedAt: docModifiedAt } : {}),
    }
    const visualArtifacts = visualArtifactFromIndexedFileResult(result)
    return visualArtifacts.length > 0 ? { ...result, visualArtifacts } : result
  }

  // localDir: look up in files table by abs_path or rel_path
  const fileRow = db
    .prepare(
      `SELECT f.abs_path, f.source_id, f.title, f.body_text, f.mime, f.size, f.mtime, s.kind AS source_kind
       FROM files f
       LEFT JOIN sources s ON s.id = f.source_id
       WHERE f.abs_path = ? OR f.rel_path = ?
       LIMIT 1`,
    )
    .get(id, id) as Record<string, unknown> | undefined

  if (fileRow) {
    let body = String(fileRow['body_text'] ?? '')
    if (!body) {
      // Try reading raw file
      try {
        body = readFileSync(String(fileRow['abs_path'] ?? id), 'utf8')
      } catch {
        body = ''
      }
    }
    const maxChars = opts?.fullBody ? Infinity : 4000
    const fileModifiedAt = modifiedAtFromFileMtime(fileRow['mtime'])
    const result: ReadIndexedFileResult = {
      id: String(fileRow['abs_path'] ?? id),
      sourceKind: String(fileRow['source_kind'] ?? 'localDir'),
      title: String(fileRow['title'] ?? id),
      bodyText: body.slice(0, maxChars),
      ...(typeof fileRow['mime'] === 'string' && fileRow['mime'] ? { mime: String(fileRow['mime']) } : {}),
      ...(typeof fileRow['size'] === 'number' ? { size: Number(fileRow['size']) } : {}),
      ...(fileModifiedAt ? { modifiedAt: fileModifiedAt } : {}),
    }
    const visualArtifacts = visualArtifactFromIndexedFileResult(result)
    return visualArtifacts.length > 0 ? { ...result, visualArtifacts } : result
  }

  return null
}

