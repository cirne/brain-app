/**
 * Incremental Google Drive → document_index sync (whole visible corpus; no folder roots).
 */

import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { drive_v3 } from 'googleapis'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import type { RipmailDb } from '../db.js'
import type { SourceConfig } from './config.js'
import { createGoogleDriveClient } from './googleDrive.js'
import {
  DRIVE_SYNC_MAX_BINARY_DOWNLOAD_BYTES,
  extractDriveFileText,
  GOOGLE_DRIVE_NATIVE_MIMES,
} from './googleDriveFileContent.js'
import { DRIVE_INGEST_CONCURRENCY, runWithConcurrencyPool } from './syncConcurrency.js'

const DRIVE_SYNC_BODY_MAX_CHARS = 400_000
/** Smaller pages → more frequent progress logs during bootstrap `files.list`. */
const DRIVE_FILES_LIST_PAGE_SIZE = 200
/** Per-request timeout for Drive HTTP calls (Gaxios). */
const DRIVE_HTTP_TIMEOUT_MS = 120_000
const driveHttpOpts = { timeout: DRIVE_HTTP_TIMEOUT_MS }

export type GoogleDriveSyncResult = {
  added: number
  updated: number
  removed: number
  error?: string
}

export type GoogleDriveSyncOpts = {
  abort?: AbortSignal
  /** Progress lines for dev/CLI (not used in Hub refresh). */
  onProgress?: (message: string) => void
  /** Dev/CLI: wipe local Drive index + fingerprints + change cursor, then run `files.list` bootstrap. */
  forceBootstrap?: boolean
}

function globToRegex(glob: string): RegExp {
  const trimmed = glob.trim()
  if (!trimmed) return /^$/
  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0DOUBLESTAR\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0DOUBLESTAR\0/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

function matchesIgnoreGlobs(name: string, globs: string[]): boolean {
  for (const g of globs) {
    if (!g.trim()) continue
    try {
      if (globToRegex(g).test(name)) return true
    } catch {
      /* invalid pattern */
    }
  }
  return false
}

function passesIncludeGlobs(name: string, globs: string[]): boolean {
  const list = globs.map((g) => g.trim()).filter(Boolean)
  if (list.length === 0) return true
  for (const g of list) {
    try {
      if (globToRegex(g).test(name)) return true
    } catch {
      /* skip */
    }
  }
  return false
}

function fileSourceMaxBytes(source: SourceConfig): number {
  const n = source.fileSource?.maxFileBytes
  return typeof n === 'number' && n > 0 ? n : 10_000_000
}

function driveFileFingerprint(f: drive_v3.Schema$File): string {
  const md5 = f.md5Checksum?.trim()
  if (md5) return `md5:${md5}`
  const rev = f.headRevisionId?.trim()
  if (rev) return `rev:${rev}`
  const mt = f.modifiedTime?.trim() ?? ''
  const sz = String(f.size ?? '')
  return `meta:${mt}:${sz}:${f.mimeType ?? ''}`
}

function upsertDocumentIndex(
  db: RipmailDb,
  sourceId: string,
  extId: string,
  title: string,
  body: string,
  dateIso: string,
): void {
  db.prepare(`DELETE FROM document_index WHERE source_id = ? AND kind = 'googleDrive' AND ext_id = ?`).run(
    sourceId,
    extId,
  )
  db.prepare(
    `INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso) VALUES (?, 'googleDrive', ?, ?, ?, ?)`,
  ).run(sourceId, extId, title, body.slice(0, DRIVE_SYNC_BODY_MAX_CHARS), dateIso)
}

function upsertCloudMeta(
  db: RipmailDb,
  sourceId: string,
  remoteId: string,
  contentHash: string,
  remoteMtime: string,
): void {
  db.prepare(
    `INSERT INTO cloud_file_meta (source_id, remote_id, content_hash, remote_mtime, cached_md_path)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(source_id, remote_id) DO UPDATE SET
       content_hash = excluded.content_hash,
       remote_mtime = excluded.remote_mtime`,
  ).run(sourceId, remoteId, contentHash, remoteMtime)
}

function removeDriveFile(db: RipmailDb, sourceId: string, remoteId: string): void {
  db.prepare(`DELETE FROM document_index WHERE source_id = ? AND kind = 'googleDrive' AND ext_id = ?`).run(
    sourceId,
    remoteId,
  )
  db.prepare(`DELETE FROM cloud_file_meta WHERE source_id = ? AND remote_id = ?`).run(sourceId, remoteId)
}

function countDriveIndexRows(db: RipmailDb, sourceId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM document_index WHERE source_id = ? AND kind = 'googleDrive'`)
    .get(sourceId) as { c: number } | undefined
  return Number(row?.c ?? 0)
}

function countCloudFileMetaRows(db: RipmailDb, sourceId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM cloud_file_meta WHERE source_id = ?`)
    .get(sourceId) as { c: number } | undefined
  return Number(row?.c ?? 0)
}

function logDriveIndexRowCount(db: RipmailDb, sourceId: string, onProgress?: (message: string) => void): void {
  onProgress?.(`[drive] local document_index rows=${countDriveIndexRows(db, sourceId)} (googleDrive, this source)`)
}

function getStoredFingerprint(db: RipmailDb, sourceId: string, remoteId: string): string | null {
  const row = db
    .prepare(`SELECT content_hash FROM cloud_file_meta WHERE source_id = ? AND remote_id = ?`)
    .get(sourceId, remoteId) as { content_hash: string } | undefined
  return row?.content_hash?.trim() ? row.content_hash : null
}

function getChangeToken(db: RipmailDb, sourceId: string): string | null {
  const row = db
    .prepare(`SELECT change_page_token FROM google_drive_sync_state WHERE source_id = ?`)
    .get(sourceId) as { change_page_token: string | null } | undefined
  const t = row?.change_page_token?.trim()
  return t || null
}

function saveChangeToken(db: RipmailDb, sourceId: string, token: string): void {
  db.prepare(
    `INSERT INTO google_drive_sync_state (source_id, change_page_token, last_synced_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(source_id) DO UPDATE SET
       change_page_token = excluded.change_page_token,
       last_synced_at = excluded.last_synced_at`,
  ).run(sourceId, token)
}

async function ingestFileIfNeeded(
  db: RipmailDb,
  drive: drive_v3.Drive,
  source: SourceConfig,
  f: drive_v3.Schema$File,
  workDir: string,
): Promise<'added' | 'updated' | 'skipped'> {
  const sourceId = source.id
  const fileId = f.id
  if (!fileId) return 'skipped'
  const mime = f.mimeType ?? ''
  if (mime === 'application/vnd.google-apps.folder') return 'skipped'

  const name = f.name ?? fileId
  const ignore = source.fileSource?.ignoreGlobs ?? []
  const include = source.fileSource?.includeGlobs ?? []
  if (matchesIgnoreGlobs(name, ignore)) return 'skipped'
  if (!passesIncludeGlobs(name, include)) return 'skipped'

  const size = Number(f.size ?? 0)
  const maxB = fileSourceMaxBytes(source)
  if (size > maxB && !GOOGLE_DRIVE_NATIVE_MIMES.has(mime)) return 'skipped'

  const fp = driveFileFingerprint(f)
  const prev = getStoredFingerprint(db, sourceId, fileId)
  if (prev === fp) return 'skipped'

  const dateIso = (f.modifiedTime ?? '').replace('T', ' ').replace(/\.\d{3}Z?$/, '').replace('Z', '') || ''
  const text = await extractDriveFileText(drive, f, workDir, driveHttpOpts, {
    maxBinaryDownloadBytes: DRIVE_SYNC_MAX_BINARY_DOWNLOAD_BYTES,
  })
  upsertDocumentIndex(db, sourceId, fileId, name, text, dateIso)
  upsertCloudMeta(db, sourceId, fileId, fp, f.modifiedTime ?? '')
  return prev ? 'updated' : 'added'
}

async function bootstrapFullList(
  db: RipmailDb,
  drive: drive_v3.Drive,
  source: SourceConfig,
  workDir: string,
  onProgress?: (message: string) => void,
): Promise<{ added: number; updated: number }> {
  let added = 0
  let updated = 0
  const queries: string[] = [
    "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
  ]
  if (source.includeSharedWithMe) {
    queries.push("sharedWithMe = true and trashed = false and mimeType != 'application/vnd.google-apps.folder'")
  }

  const seen = new Set<string>()
  let queryIdx = 0
  for (const q of queries) {
    queryIdx += 1
    let pageToken: string | undefined
    let page = 0
    do {
      page += 1
      const beforeA = added
      const beforeU = updated
      const tList0 = Date.now()
      const res = await drive.files.list(
        {
          q,
          pageSize: DRIVE_FILES_LIST_PAGE_SIZE,
          pageToken,
          fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, md5Checksum, size, headRevisionId)',
          corpora: 'user',
        },
        driveHttpOpts,
      )
      const listMs = Date.now() - tList0
      const batch = res.data.files?.length ?? 0
      const list = (res.data.files ?? []).filter((f) => {
        const id = f.id
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      const results = await runWithConcurrencyPool(list, DRIVE_INGEST_CONCURRENCY, async (f) =>
        ingestFileIfNeeded(db, drive, source, f, workDir),
      )
      for (const r of results) {
        if (r === 'added') added += 1
        else if (r === 'updated') updated += 1
      }
      const dA = added - beforeA
      const dU = updated - beforeU
      onProgress?.(
        `[drive] bootstrap q${queryIdx}/${queries.length} page=${page} list=${listMs}ms files=${batch} new=${list.length} +${dA} ~${dU} (cum +${added} ~${updated} unique=${seen.size}) next=${Boolean(res.data.nextPageToken)}`,
      )
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  }

  onProgress?.('[drive] bootstrap fetching change cursor…')
  const tTok0 = Date.now()
  const start = await drive.changes.getStartPageToken({ supportsAllDrives: true }, driveHttpOpts)
  const token = start.data.startPageToken
  if (token) saveChangeToken(db, source.id, token)
  onProgress?.(
    `[drive] bootstrap change cursor saved (${Date.now() - tTok0}ms, tokenLen=${token?.length ?? 0})`,
  )
  return { added, updated }
}

async function applyChanges(
  db: RipmailDb,
  drive: drive_v3.Drive,
  source: SourceConfig,
  startToken: string,
  workDir: string,
  onProgress?: (message: string) => void,
): Promise<{ added: number; updated: number; removed: number; newStartToken: string | null }> {
  let added = 0
  let updated = 0
  let removed = 0
  let cursor: string | undefined = startToken
  let newStartToken: string | null = null
  let page = 0

  while (cursor) {
    page += 1
    const beforeA = added
    const beforeU = updated
    const beforeR = removed
    const tCh0 = Date.now()
    const listRes = (await drive.changes.list(
      {
        pageToken: cursor,
        fields:
          'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, modifiedTime, md5Checksum, size, headRevisionId, trashed))',
        includeRemoved: true,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: DRIVE_FILES_LIST_PAGE_SIZE,
      },
      driveHttpOpts,
    )) as { data: drive_v3.Schema$ChangeList }
    const listMs = Date.now() - tCh0

    const toIngest: drive_v3.Schema$File[] = []
    for (const ch of listRes.data.changes ?? []) {
      const fileId = ch.fileId
      if (!fileId) continue
      if (ch.removed || ch.file?.trashed) {
        removeDriveFile(db, source.id, fileId)
        removed += 1
        continue
      }
      let f = ch.file ?? undefined
      if (!f?.mimeType) {
        try {
          const full = await drive.files.get(
            {
              fileId,
              fields: 'id, name, mimeType, modifiedTime, md5Checksum, size, headRevisionId, trashed',
              supportsAllDrives: true,
            },
            driveHttpOpts,
          )
          f = full.data
        } catch {
          continue
        }
      }
      if (!f?.id || f.trashed) {
        removeDriveFile(db, source.id, fileId)
        removed += 1
        continue
      }
      toIngest.push(f)
    }
    const ingestResults = await runWithConcurrencyPool(toIngest, DRIVE_INGEST_CONCURRENCY, (f) =>
      ingestFileIfNeeded(db, drive, source, f, workDir),
    )
    for (const r of ingestResults) {
      if (r === 'added') added += 1
      else if (r === 'updated') updated += 1
    }

    const chLen = listRes.data.changes?.length ?? 0
    const dA = added - beforeA
    const dU = updated - beforeU
    const dR = removed - beforeR
    onProgress?.(
      `[drive] incremental page=${page} list=${listMs}ms changes=${chLen} +${dA} ~${dU} -${dR} (cum +${added} ~${updated} -${removed}) next=${Boolean(listRes.data.nextPageToken)}`,
    )

    newStartToken = listRes.data.newStartPageToken ?? newStartToken
    cursor = listRes.data.nextPageToken ?? undefined
    if (!cursor && listRes.data.newStartPageToken) {
      newStartToken = listRes.data.newStartPageToken
      break
    }
  }

  return { added, updated, removed, newStartToken }
}

export async function syncGoogleDriveSource(
  db: RipmailDb,
  ripmailHome: string,
  source: SourceConfig,
  opts?: GoogleDriveSyncOpts,
): Promise<GoogleDriveSyncResult> {
  if (source.kind !== 'googleDrive') return { added: 0, updated: 0, removed: 0, error: 'not a googleDrive source' }

  const onProgress = opts?.onProgress

  const client = createGoogleDriveClient(ripmailHome, source)
  if (!client) {
    onProgress?.(`[drive] sync ${source.id}: no OAuth token file`)
    return { added: 0, updated: 0, removed: 0, error: 'No Google OAuth token file available for Drive sync' }
  }

  const { drive } = client
  const workRoot = join(ripmailHome, source.id, 'cache', 'sync-work')
  mkdirSync(workRoot, { recursive: true })
  let workDir: string | null = null
  try {
    workDir = await mkdtemp(join(workRoot, 'batch-'))
    if (opts?.forceBootstrap) {
      const docRows = countDriveIndexRows(db, source.id)
      const metaRows = countCloudFileMetaRows(db, source.id)
      db.prepare(`DELETE FROM document_index WHERE source_id = ? AND kind = 'googleDrive'`).run(source.id)
      db.prepare(`DELETE FROM cloud_file_meta WHERE source_id = ?`).run(source.id)
      db.prepare(`DELETE FROM google_drive_sync_state WHERE source_id = ?`).run(source.id)
      onProgress?.(
        `[drive] forceBootstrap: deleted ${docRows} document_index + ${metaRows} cloud_file_meta rows and sync cursor for source (full re-index next)`,
      )
    }
    const existing = getChangeToken(db, source.id)
    onProgress?.(`[drive] sync ${source.id} (${existing ? 'incremental' : 'bootstrap'})`)
    if (!existing) {
      const { added, updated } = await bootstrapFullList(db, drive, source, workDir, onProgress)
      onProgress?.(`[drive] bootstrap finished +${added} ~${updated}`)
      logDriveIndexRowCount(db, source.id, onProgress)
      return { added, updated, removed: 0 }
    }

    const { added, updated, removed, newStartToken } = await applyChanges(db, drive, source, existing, workDir, onProgress)
    if (newStartToken) saveChangeToken(db, source.id, newStartToken)
    onProgress?.(`[drive] incremental finished +${added} ~${updated} -${removed}`)
    logDriveIndexRowCount(db, source.id, onProgress)
    if (added === 0 && updated === 0 && removed === 0) {
      const n = countDriveIndexRows(db, source.id)
      if (n === 0) {
        onProgress?.(
          '[drive] hint: local googleDrive index is empty but incremental saw no deltas. Re-run with DRIVE_E2E_FORCE_DRIVE_BOOTSTRAP=1 (wipes local Drive rows + cursor); dev harness: npm run drive:e2e -- <workspace-handle> (scripts/dev-drive-sync-e2e.ts).',
        )
      }
    }
    return { added, updated, removed }
  } catch (e) {
    const msg = String(e)
    brainLogger.warn({ sourceId: source.id, err: msg }, 'ripmail:drive:sync-error')
    return { added: 0, updated: 0, removed: 0, error: msg }
  } finally {
    if (workDir) {
      try {
        await rm(workDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    if (opts?.abort?.aborted) {
      /* best-effort */
    }
  }
}

export function getGoogleDriveSources(sources: SourceConfig[] | undefined): SourceConfig[] {
  return (sources ?? []).filter((s) => s.kind === 'googleDrive')
}
