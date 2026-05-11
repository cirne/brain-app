/**
 * Maildir → SQLite rebuild (`ripmail rebuild-index`) in TypeScript.
 * Mirrors ripmail/src/rebuild_index.rs + post-rebuild bootstrap (ripmail/src/cli/commands/sync.rs).
 */

import type { Dirent } from 'node:fs'
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import type { RipmailDb } from './db.js'
import {
  invalidateRipmailDbCache,
  markRipmailDbSchemaReady,
  openRipmailDbForRepopulate,
} from './db.js'
import { parseInboxWindowToIsoCutoff } from './inboxWindow.js'
import {
  applyRebuildIndexDateNormalization,
  isUntrustworthyIndexDateStr,
  parseStoredIndexDateUtc,
} from './sync/ingestDate.js'
import { parseEml } from './sync/parse.js'
import { loadRipmailConfig, getImapSources } from './sync/config.js'

/**
 * Maildir rebuild does lots of sync SQLite + fs work. Yield occasionally so TLS/HTTP/SSE
 * (e.g. POST /api/chat) are not starved for the entire rebuild (see prepareRipmailDb drift path).
 */
function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Parse steps before one `setImmediate` yield. */
const REBUILD_PARSE_YIELD_INTERVAL = 48

/** Rows committed per SQLite transaction; smaller values yield the loop more often. */
const REBUILD_INSERT_CHUNK_SIZE = 400

/** `minTrustworthyIndexDateInMaildir` batch size (avoids one huge Promise.all + long sync stretches). */
const REBUILD_MIN_TRUSTWORTHY_BATCH = 48

const REBUILD_PARSE_PROGRESS_INTERVAL = REBUILD_PARSE_YIELD_INTERVAL * 10
const REBUILD_INSERT_PROGRESS_CHUNKS = 5

const DEFAULT_IMAP_FOLDER = '[Gmail]/All Mail'
const LABELS_JSON = '[]'

type RebuildProgressContext = {
  rootIndex: number
  rootCount: number
}

function rebuildLogBase(ripmailHome: string) {
  return {
    kind: 'ripmail_rebuild',
    ripmailHome,
  }
}

function logRebuildPhase(
  ripmailHome: string,
  fields: Record<string, unknown>,
  message = 'ripmail:rebuild:phase',
): void {
  brainLogger.info(
    {
      ...rebuildLogBase(ripmailHome),
      ...fields,
    },
    message,
  )
}

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

/** Mailbox maildirs under a ripmail home (multi-account + legacy `maildir/`). */
export function discoverRipmailMaildirRoots(ripmailHome: string): string[] {
  const roots = new Set<string>()
  const legacy = join(ripmailHome, 'maildir')
  try {
    if (statSync(legacy).isDirectory()) roots.add(legacy)
  } catch {
    /* */
  }
  const cfg = loadRipmailConfig(ripmailHome)
  for (const s of getImapSources(cfg)) {
    const p = join(ripmailHome, s.id, 'maildir')
    try {
      if (statSync(p).isDirectory()) roots.add(p)
    } catch {
      /* */
    }
  }
  let rd: Dirent[]
  try {
    rd = readdirSync(ripmailHome, { withFileTypes: true }) as Dirent[]
  } catch {
    return [...roots].sort()
  }
  for (const e of rd) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const p = join(ripmailHome, e.name, 'maildir')
    try {
      if (statSync(p).isDirectory()) roots.add(p)
    } catch {
      /* */
    }
  }
  return [...roots].sort()
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

  for (let i = 0; i < paths.length; i += REBUILD_MIN_TRUSTWORTHY_BATCH) {
    const slice = paths.slice(i, i + REBUILD_MIN_TRUSTWORTHY_BATCH)
    const dates = await Promise.all(
      slice.map(async (path) => {
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
    await yieldEventLoop()
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
 * Append messages from one maildir tree (must not DELETE global index — caller clears once).
 */
export async function appendMaildirToOpenDb(
  db: RipmailDb,
  ripmailHome: string,
  maildirRoot: string,
  uidOffset: number,
  progress?: RebuildProgressContext,
): Promise<{ inserted: number; nextUidExclusive: number }> {
  const mailboxId = inferMailboxIdFromMaildirRoot(maildirRoot)
  const paths = collectEmlPaths(maildirRoot)
  if (progress) {
    logRebuildPhase(ripmailHome, {
      phase: 'maildir',
      rootIndex: progress.rootIndex,
      rootCount: progress.rootCount,
      mailboxId,
      maildirRoot,
      emlDiscovered: paths.length,
    })
  }
  const batchFloor = await minTrustworthyIndexDateInMaildir(paths, mailboxId)

  type ParsedRow = {
    uid: number
    msg: Awaited<ReturnType<typeof parseEml>>
    rawRel: string
  }

  const parsedRows: ParsedRow[] = []
  let uid = uidOffset
  let parseCount = 0
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

    parsedRows.push({ uid, msg, rawRel })

    parseCount += 1
    if (parseCount % REBUILD_PARSE_YIELD_INTERVAL === 0) {
      await yieldEventLoop()
    }
    if (progress && parseCount % REBUILD_PARSE_PROGRESS_INTERVAL === 0) {
      logRebuildPhase(
        ripmailHome,
        {
          phase: 'parse',
          rootIndex: progress.rootIndex,
          rootCount: progress.rootCount,
          mailboxId,
          parsed: parseCount,
          emlDiscovered: paths.length,
        },
        'ripmail:rebuild:progress',
      )
    }
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
        const mime = att.mimeType?.trim() ? att.mimeType : mimeFromExt(att.filename)
        insertAttachment.run(mid, att.filename, mime, att.size, '')
      }
      inserted += 1
    }
    return inserted
  })

  let inserted = 0
  for (let i = 0; i < parsedRows.length; i += REBUILD_INSERT_CHUNK_SIZE) {
    const chunk = parsedRows.slice(i, i + REBUILD_INSERT_CHUNK_SIZE)
    inserted += trx(chunk)
    const chunkIndex = Math.floor(i / REBUILD_INSERT_CHUNK_SIZE) + 1
    if (progress && chunkIndex % REBUILD_INSERT_PROGRESS_CHUNKS === 0) {
      logRebuildPhase(
        ripmailHome,
        {
          phase: 'insert',
          rootIndex: progress.rootIndex,
          rootCount: progress.rootCount,
          mailboxId,
          insertedSoFar: inserted,
          parsed: parsedRows.length,
        },
        'ripmail:rebuild:progress',
      )
    }
    await yieldEventLoop()
  }
  if (progress) {
    logRebuildPhase(ripmailHome, {
      phase: 'maildir_complete',
      rootIndex: progress.rootIndex,
      rootCount: progress.rootCount,
      mailboxId,
      inserted,
      parsed: parsedRows.length,
    })
  }
  return { inserted, nextUidExclusive: uid }
}

/** After wiping `ripmail.db`, refill the mail index from all local mailbox maildirs (no snapshots). */
export async function repopulateRipmailIndexFromAllMaildirs(ripmailHome: string): Promise<number> {
  const startedAt = Date.now()
  mkdirSync(ripmailHome, { recursive: true })
  invalidateRipmailDbCache(ripmailHome)

  const db = openRipmailDbForRepopulate(ripmailHome)
  try {
    db.exec(DELETE_INDEX_DATA)
    const roots = discoverRipmailMaildirRoots(ripmailHome)
    logRebuildPhase(ripmailHome, {
      phase: 'start',
      mailboxCount: roots.length,
    })

    let nextUidExclusive = 0
    let total = 0
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i]
      const { inserted, nextUidExclusive: next } = await appendMaildirToOpenDb(
        db,
        ripmailHome,
        root,
        nextUidExclusive,
        { rootIndex: i + 1, rootCount: roots.length },
      )
      total += inserted
      nextUidExclusive = next
      await yieldEventLoop()
    }
    runPostRebuildBootstrapTs(db)
    markRipmailDbSchemaReady(db)
    logRebuildPhase(ripmailHome, {
      phase: 'complete',
      totalInserted: total,
      mailboxCount: roots.length,
      durationMs: Date.now() - startedAt,
    })
    return total
  } finally {
    db.close()
    invalidateRipmailDbCache(ripmailHome)
  }
}

/**
 * Wipe indexed mail then import every `.eml` under `maildirRoot`.
 * `ripmailHome` is `$RIPMAIL_HOME`; stored `raw_path` values are relative to it.
 */
export async function rebuildIndexFromMaildir(ripmailHome: string, maildirRoot: string): Promise<number> {
  const startedAt = Date.now()
  mkdirSync(ripmailHome, { recursive: true })
  invalidateRipmailDbCache(ripmailHome)

  const db = openRipmailDbForRepopulate(ripmailHome)
  try {
    db.exec(DELETE_INDEX_DATA)
    logRebuildPhase(ripmailHome, {
      phase: 'start',
      mailboxCount: 1,
    })
    const { inserted } = await appendMaildirToOpenDb(db, ripmailHome, maildirRoot, 0, {
      rootIndex: 1,
      rootCount: 1,
    })
    runPostRebuildBootstrapTs(db)
    markRipmailDbSchemaReady(db)
    logRebuildPhase(ripmailHome, {
      phase: 'complete',
      totalInserted: inserted,
      mailboxCount: 1,
      durationMs: Date.now() - startedAt,
    })
    return inserted
  } finally {
    db.close()
    invalidateRipmailDbCache(ripmailHome)
  }
}
