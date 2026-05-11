/**
 * Attachment list and read — mirrors ripmail attachment list / read commands.
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { htmlToAgentMarkdown } from '../lib/htmlToAgentMarkdown.js'
import type { RipmailDb } from './db.js'
import type { AttachmentMeta } from './types.js'

interface AttachmentDbRow {
  id: number
  message_id: string
  filename: string
  mime_type: string
  size: number
  stored_path: string
  extracted_text: string | null
}

/** LLMs often pass `"1"` instead of a numeric index — treat digit-only strings as 1-based indices. */
export function normalizeAttachmentLookupKey(key: string | number): string | number {
  if (typeof key === 'string') {
    const t = key.trim()
    if (/^\d+$/.test(t)) {
      const n = Number(t)
      if (n >= 1 && Number.isSafeInteger(n)) return n
    }
  }
  return key
}

function attachmentAbsPath(storedPath: string, ripmailHome: string): string {
  return storedPath.startsWith('/') ? storedPath : join(ripmailHome, storedPath)
}

function storedPathPointsToReadableFile(storedPath: string, ripmailHome: string): boolean {
  const t = storedPath?.trim()
  if (!t) return false
  const abs = attachmentAbsPath(t, ripmailHome)
  try {
    return statSync(abs).isFile()
  } catch {
    return false
  }
}

function resolveMessageId(db: RipmailDb, messageId: string): string {
  const stmt = db.prepare(`SELECT message_id FROM messages WHERE message_id = ? LIMIT 1`)
  const raw = stmt.get(messageId) as { message_id: string } | undefined
  if (raw) return raw.message_id
  if (!messageId.startsWith('<')) {
    const br = stmt.get(`<${messageId}>`) as { message_id: string } | undefined
    if (br) return br.message_id
  }
  if (messageId.startsWith('<') && messageId.endsWith('>')) {
    const nb = stmt.get(messageId.slice(1, -1)) as { message_id: string } | undefined
    if (nb) return nb.message_id
  }
  return messageId
}

export function attachmentList(db: RipmailDb, messageId: string): AttachmentMeta[] {
  const resolvedId = resolveMessageId(db, messageId)
  const rows = db
    .prepare(
      `SELECT id, message_id, filename, mime_type, size, stored_path, extracted_text
       FROM attachments WHERE message_id = ? ORDER BY id`,
    )
    .all(resolvedId) as AttachmentDbRow[]

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
 * Read and extract text from an attachment.
 * `key` is either a 1-based index (number) or a filename (string).
 * Caches extracted text back to the DB on first read.
 */
export async function attachmentRead(
  db: RipmailDb,
  messageId: string,
  key: string | number,
  ripmailHome: string,
): Promise<string> {
  const lookupKey = normalizeAttachmentLookupKey(key)
  const resolvedId = resolveMessageId(db, messageId)
  const rows = db
    .prepare(
      `SELECT id, filename, mime_type, stored_path, extracted_text
       FROM attachments WHERE message_id = ? ORDER BY id`,
    )
    .all(resolvedId) as AttachmentDbRow[]

  if (rows.length === 0) return '(no attachments)'

  let candidates: AttachmentDbRow[]
  if (typeof lookupKey === 'number') {
    const at = rows[lookupKey - 1]
    candidates = at ? [at] : []
  } else {
    const k = lookupKey.toLowerCase()
    candidates = rows.filter((r) => r.filename.toLowerCase() === k)
  }

  const row =
    candidates.find((r) => storedPathPointsToReadableFile(r.stored_path, ripmailHome)) ?? candidates[0]

  if (!row) return `(attachment not found: ${key})`

  if (row.extracted_text != null) return row.extracted_text

  const absPath = attachmentAbsPath(row.stored_path, ripmailHome)

  if (!row.stored_path?.trim()) {
    return '(attachment file not found on disk: missing stored path; try refresh_sources / re-sync)'
  }

  if (!existsSync(absPath)) return '(attachment file not found on disk)'

  try {
    const st = statSync(absPath)
    if (!st.isFile()) {
      return '(attachment path is not a regular file; try re-syncing mail)'
    }
  } catch {
    return '(attachment file not found on disk)'
  }

  const extracted = await extractAttachmentText(absPath, row.mime_type)

  // Cache back to DB
  db.prepare(`UPDATE attachments SET extracted_text = ? WHERE id = ?`).run(extracted, row.id)

  return extracted
}

/** Same MIME/extension extraction logic used when caching attachment bodies (exported for tests). */
export async function extractAttachmentText(absPath: string, mimeType: string): Promise<string> {
  const mime = mimeType.toLowerCase()

  if (mime === 'application/pdf' || absPath.endsWith('.pdf')) {
    try {
      const { PDFParse } = await import('pdf-parse')
      const buf = readFileSync(absPath)
      const parser = new PDFParse({ data: buf })
      try {
        const result = await parser.getText()
        return result.text ?? ''
      } finally {
        await parser.destroy()
      }
    } catch (e) {
      return `(PDF extraction failed: ${String(e)})`
    }
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    absPath.endsWith('.docx')
  ) {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.convertToHtml({ path: absPath })
      return htmlToAgentMarkdown(result.value ?? '')
    } catch (e) {
      return `(DOCX extraction failed: ${String(e)})`
    }
  }

  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    absPath.endsWith('.xlsx') ||
    absPath.endsWith('.xls')
  ) {
    try {
      const XLSX = await import('xlsx')
      const buf = readFileSync(absPath)
      const wb = XLSX.read(buf, { type: 'buffer' })
      const sheets = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name]!
        return `## ${name}\n${XLSX.utils.sheet_to_csv(ws)}`
      })
      return sheets.join('\n\n')
    } catch (e) {
      return `(Excel extraction failed: ${String(e)})`
    }
  }

  if (mime === 'text/html' || absPath.endsWith('.html') || absPath.endsWith('.htm')) {
    const html = readFileSync(absPath, 'utf8')
    return htmlToAgentMarkdown(html)
  }

  if (mime === 'text/csv' || absPath.endsWith('.csv')) {
    return readFileSync(absPath, 'utf8')
  }

  if (mime.startsWith('text/') || absPath.endsWith('.txt') || absPath.endsWith('.md')) {
    return readFileSync(absPath, 'utf8')
  }

  return `(unsupported mime type for extraction: ${mimeType})`
}
