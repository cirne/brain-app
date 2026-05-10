/**
 * Maildir → SQLite rebuild (`ripmail rebuild-index`) in TypeScript.
 * Mirrors ripmail/src/rebuild_index.rs + post-rebuild bootstrap (ripmail/src/cli/commands/sync.rs).
 */

import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import type { RipmailDb } from './db.js'
import { invalidateRipmailDbCache, openRipmailDb } from './db.js'
import { parseInboxWindowToIsoCutoff } from './inboxWindow.js'
import {
  applyRebuildIndexDateNormalization,
  isUntrustworthyIndexDateStr,
  parseStoredIndexDateUtc,
} from './sync/ingestDate.js'
import { parseEml } from './sync/parse.js'

const DEFAULT_IMAP_FOLDER = '[Gmail]/All Mail'
const LABELS_JSON = '[]'

/** Infer mailbox source id from `<ripmail_home>/<id>/maildir/...` layout. */
export function inferMailboxIdFromMaildirRoot(maildirRoot: string): string {
  const norm = maildirRoot.replace(/\\/g, '/')
  const parts = norm.split('/').filter(Boolean)
  if (parts.length >= 2 && parts[parts.length - 1] === 'maildir') {
    return parts[parts.length - 2] ?? ''
  }
  return ''
}

/** Paths under `root` ending in `.eml`, sorted (Rust rebuild_index collect_eml_paths). */
export function collectEmlPaths(root: string): string[] {
  const out: string[] = []
  function walk(dir: string): void {
    let rd
    try {
      rd = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of rd) {
      const p = resolve(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.isFile() && ent.name.endsWith('.eml')) out.push(p)
    }
  }
  walk(root)
  out.sort()
  return out
}

/** Store `raw_path` relative to ripmail home with `/` separators (Rust raw_path_for_sqlite_store). */
export function rawPathForSqliteStore(ripmailHome: string, emlPath: string): string {
  const homeAbs = resolve(ripmailHome)
  const emlAbs = resolve(emlPath)
  let rel = relative(homeAbs, emlAbs)
  if (rel.startsWith('..') || rel.includes('..')) {
    throw new Error(`rebuild-index: eml ${emlPath} must be under RIPMAIL_HOME ${ripmailHome}`)
  }
  return rel.split(sep).join('/')
}

function mimeFromExt(filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? '' : ''
  switch (ext) {
    case 'pdf':
      return 'application/pdf'
    case 'doc':
      return 'application/msword'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xls':
      return 'application/vnd.ms-excel'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'txt':
      return 'text/plain'
    case 'html':
    case 'htm':
      return 'text/html'
    case 'csv':
      return 'text/csv'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'zip':
      return 'application/zip'
    default:
      return 'application/octet-stream'
  }
}

async function minTrustworthyIndexDateInMaildir(paths: string[], mailboxId: string): Promise<string | undefined> {
  let best: Date | undefined

  const dates = await Promise.all(
    paths.map(async (path) => {
      try {
        const buf = readFileSync(path)
        const p = await parseEml(buf, path, {
          folder: DEFAULT_IMAP_FOLDER,
          uid: 0,
          sourceId: mailboxId || 'mailbox',
        })
        if (!isUntrustworthyIndexDateStr(p.date)) {
          const d = parseStoredIndexDateUtc(p.date)
          if (d) return d
        }
      } catch {
        /* skip */
      }
      return undefined
    }),
  )

  for (const d of dates) {
    if (!d) continue
    if (!best || d < best) best = d
  }
  return best?.toISOString()
}

export function clearRipmailInboxTables(db: RipmailDb): void {
  db.exec(`
    DELETE FROM inbox_alerts;
    DELETE FROM inbox_reviews;
    DELETE FROM inbox_decisions;
    DELETE FROM inbox_scans;
  `)
}

export function bulkArchiveMessagesOlderThan(db: RipmailDb, cutoffIso: string): number {
  return db
    .prepare(`UPDATE messages SET is_archived = 1 WHERE date < ? AND is_archived = 0`)
    .run(cutoffIso).changes
}

/** Mirrors ripmail `run_post_rebuild_inbox_bootstrap` bulk-archive step (1d window); inbox scan skipped when no recent mail (Enron). */
export function runPostRebuildBootstrapTs(db: RipmailDb): void {
  clearRipmailInboxTables(db)
  const cutoff = parseInboxWindowToIsoCutoff('1d')
  bulkArchiveMessagesOlderThan(db, cutoff)
}

const DELETE_INDEX_DATA = `
DELETE FROM inbox_alerts;
DELETE FROM inbox_reviews;
DELETE FROM inbox_decisions;
DELETE FROM inbox_scans;
DELETE FROM attachments;
DELETE FROM messages;
DELETE FROM threads;
`

/**
 * Wipe indexed mail then import every `.eml` under `maildirRoot`.
 * `ripmailHome` is `$RIPMAIL_HOME`; stored `raw_path` values are relative to it.
 */
export async function rebuildIndexFromMaildir(ripmailHome: string, maildirRoot: string): Promise<number> {
  mkdirSync(ripmailHome, { recursive: true })
  invalidateRipmailDbCache(ripmailHome)

  const db = openRipmailDb(ripmailHome)
  const mailboxId = inferMailboxIdFromMaildirRoot(maildirRoot)
  const paths = collectEmlPaths(maildirRoot)
  const batchFloor = await minTrustworthyIndexDateInMaildir(paths, mailboxId)

  type ParsedRow = {
    path: string
    uid: number
    msg: Awaited<ReturnType<typeof parseEml>>
    rawRel: string
  }

  const parsedRows: ParsedRow[] = []
  let uid = 0
  for (const path of paths) {
    let buf: Buffer
    try {
      buf = readFileSync(path)
    } catch {
      continue
    }
    let msg: Awaited<ReturnType<typeof parseEml>>
    try {
      msg = await parseEml(buf, path, {
        folder: DEFAULT_IMAP_FOLDER,
        uid: uid + 1,
        sourceId: mailboxId,
      })
    } catch {
      continue
    }

    uid += 1

    let rawRel: string
    try {
      rawRel = rawPathForSqliteStore(ripmailHome, path)
    } catch {
      continue
    }

    if (!applyRebuildIndexDateNormalization(msg, batchFloor, rawRel)) {
      continue
    }

    parsedRows.push({ path, uid, msg, rawRel })
  }

  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (
      message_id, thread_id, folder, uid, labels, category,
      from_address, from_name, to_addresses, cc_addresses,
      to_recipients, cc_recipients, subject, date, body_text,
      raw_path, source_id, is_archived, synced_at,
      is_reply, recipient_count, list_like
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, 0, datetime('now'),
      ?, ?, ?
    )
  `)

  const upsertThread = db.prepare(`
    INSERT OR REPLACE INTO threads (thread_id, subject, participant_count, message_count, last_message_at)
    VALUES (?, ?, 1, 1, ?)
  `)

  const insertAttachment = db.prepare(`
    INSERT INTO attachments (message_id, filename, mime_type, size, stored_path, extracted_text)
    VALUES (?, ?, ?, ?, ?, NULL)
  `)

  const trx = db.transaction((rows: ParsedRow[]) => {
    db.exec(DELETE_INDEX_DATA)
    let inserted = 0
    for (const row of rows) {
      const stripped = row.msg.messageId.replace(/^<|>$/g, '')
      const mid = `<${stripped}>`
      const threadId = mid
      const category = row.msg.category ?? null
      const toJson = JSON.stringify(row.msg.toAddresses)
      const ccJson = JSON.stringify(row.msg.ccAddresses)
      const toRecJson = JSON.stringify(row.msg.toRecipients)
      const ccRecJson = JSON.stringify(row.msg.ccRecipients)

      const info = insertMessage.run(
        mid,
        threadId,
        DEFAULT_IMAP_FOLDER,
        row.uid,
        LABELS_JSON,
        category,
        row.msg.fromAddress,
        row.msg.fromName ?? null,
        toJson,
        ccJson,
        toRecJson,
        ccRecJson,
        row.msg.subject,
        row.msg.date,
        row.msg.bodyText,
        row.rawRel,
        mailboxId,
        row.msg.isReply ? 1 : 0,
        row.msg.recipientCount,
        row.msg.listLike ? 1 : 0,
      )

      if (info.changes === 0) continue

      upsertThread.run(mid, row.msg.subject, row.msg.date)

      for (const att of row.msg.attachments) {
        const mime =
          att.mimeType?.trim() ? att.mimeType : mimeFromExt(att.filename)
        insertAttachment.run(mid, att.filename, mime, att.size, '')
      }
      inserted += 1
    }
    return inserted
  })

  const n = trx(parsedRows)
  runPostRebuildBootstrapTs(db)
  return n
}
