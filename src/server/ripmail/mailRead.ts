/**
 * readMail() and readIndexedFile() — mirrors ripmail/src/mail_read.rs.
 */

import { readFileSync } from 'node:fs'
import type { RipmailDb } from './db.js'
import type { ReadMailResult, ReadIndexedFileResult, AttachmentMeta } from './types.js'

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

export function readMail(
  db: RipmailDb,
  messageId: string,
  opts?: { plainBody?: boolean; fullBody?: boolean; includeAttachments?: boolean },
): ReadMailResult | null {
  const resolvedId = resolveMessageId(db, messageId)
  if (!resolvedId) return null

  const row = db
    .prepare(
      `SELECT message_id, thread_id, source_id, from_address, from_name,
              to_addresses, cc_addresses, subject, date, body_text,
              raw_path, is_archived, category
       FROM messages WHERE message_id = ?`,
    )
    .get(resolvedId) as MessageRow | undefined

  if (!row) return null

  const attachments = opts?.includeAttachments !== false ? listAttachments(db, row.message_id) : undefined

  let bodyText: string | undefined = row.body_text ?? undefined
  if (opts?.plainBody === false) bodyText = undefined

  // Normalize messageId: strip angle brackets to match Rust CLI output shape
  const normalizedMessageId = row.message_id.startsWith('<') && row.message_id.endsWith('>')
    ? row.message_id.slice(1, -1)
    : row.message_id

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
    rawPath: row.raw_path,
    isArchived: row.is_archived === 1,
    category: row.category ?? undefined,
    attachments,
  }
}

/**
 * Read an indexed file (Drive, localDir) by its ID/path.
 */
export function readIndexedFile(
  db: RipmailDb,
  id: string,
  opts?: { fullBody?: boolean },
): ReadIndexedFileResult | null {
  // Drive: document_index entry with ext_id = id
  const diRow = db
    .prepare(
      `SELECT di.ext_id, di.source_id, di.title, di.body, di.kind, s.kind AS source_kind
       FROM document_index di
       LEFT JOIN sources s ON s.id = di.source_id
       WHERE di.ext_id = ? AND di.kind IN ('googleDrive', 'file')
       LIMIT 1`,
    )
    .get(id) as Record<string, unknown> | undefined

  if (diRow) {
    const body = String(diRow['body'] ?? '')
    const maxChars = opts?.fullBody ? Infinity : 4000
    return {
      id: String(diRow['ext_id'] ?? id),
      sourceKind: String(diRow['source_kind'] ?? diRow['kind'] ?? ''),
      title: String(diRow['title'] ?? ''),
      bodyText: body.slice(0, maxChars),
    }
  }

  // localDir: look up in files table by abs_path or rel_path
  const fileRow = db
    .prepare(
      `SELECT f.abs_path, f.source_id, f.title, f.body_text, s.kind AS source_kind
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
    return {
      id: String(fileRow['abs_path'] ?? id),
      sourceKind: String(fileRow['source_kind'] ?? 'localDir'),
      title: String(fileRow['title'] ?? id),
      bodyText: body.slice(0, maxChars),
    }
  }

  return null
}

