/**
 * Authoritative Google Drive file read with disk cache validated by remote fingerprint
 * (same formula as sync → {@link driveFileFingerprint}).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { drive_v3 } from 'googleapis'
import { loadRipmailConfig } from './config.js'
import { createGoogleDriveClient } from './googleDrive.js'
import { extractDriveFileText } from './googleDriveFileContent.js'
import { driveFileFingerprint } from './googleDriveFileFingerprint.js'

const DRIVE_READ_BODY_META_FIELDS =
  'id, name, mimeType, modifiedTime, md5Checksum, size, headRevisionId, trashed' as const

function bodyCachePaths(ripmailHome: string, sourceId: string, fileId: string) {
  const h = createHash('sha256').update(`${sourceId}\0${fileId}`).digest('hex')
  const dir = join(ripmailHome, sourceId, 'cache', 'read-body')
  const path = join(dir, `${h}.txt`)
  return { dir, path, metaPath: `${path}.meta.json` }
}

function invalidateBodyCache(path: string, metaPath: string): void {
  try {
    unlinkSync(path)
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(metaPath)
  } catch {
    /* ignore */
  }
}

export type GoogleDriveReadBodyOk = {
  text: string
  mime: string
  title: string
}

type ReadBodyMetaJson = {
  title?: string
  mime?: string
  contentFingerprint?: string
}

/** Fetch full text for a Drive file id; uses fingerprint-validated disk cache under ripmail source dir. */
export async function readGoogleDriveFileBodyCached(
  ripmailHome: string,
  sourceId: string,
  fileId: string,
): Promise<GoogleDriveReadBodyOk | null> {
  const config = loadRipmailConfig(ripmailHome)
  const source = (config.sources ?? []).find((s) => s.id === sourceId)
  if (!source || source.kind !== 'googleDrive') return null

  const { dir, path, metaPath } = bodyCachePaths(ripmailHome, sourceId, fileId)

  const client = createGoogleDriveClient(ripmailHome, source)
  if (!client) return null

  const meta = await client.drive.files.get({
    fileId,
    fields: DRIVE_READ_BODY_META_FIELDS,
    supportsAllDrives: true,
  })
  const f = meta.data as drive_v3.Schema$File
  if (!f.id) return null

  if (f.trashed) {
    invalidateBodyCache(path, metaPath)
    return null
  }

  const remoteFp = driveFileFingerprint(f)

  if (existsSync(path) && existsSync(metaPath)) {
    try {
      const cachedText = readFileSync(path, 'utf8')
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as ReadBodyMetaJson
      const cachedFp = typeof parsed.contentFingerprint === 'string' ? parsed.contentFingerprint.trim() : ''
      if (cachedText.trim().length > 0 && cachedFp && cachedFp === remoteFp) {
        return {
          text: cachedText,
          mime: typeof parsed.mime === 'string' ? parsed.mime : f.mimeType ?? 'application/octet-stream',
          title: typeof parsed.title === 'string' ? parsed.title : f.name ?? fileId,
        }
      }
      if (!cachedText.trim()) {
        invalidateBodyCache(path, metaPath)
      }
    } catch {
      /* refetch below */
    }
  }

  mkdirSync(dir, { recursive: true })
  const workRoot = join(ripmailHome, sourceId, 'cache', 'read-work')
  mkdirSync(workRoot, { recursive: true })
  const workDir = await mkdtemp(join(workRoot, 'rb-'))
  try {
    const text = await extractDriveFileText(client.drive, f, workDir)
    if (!text.trim()) {
      return null
    }
    writeFileSync(path, text, 'utf8')
    writeFileSync(
      metaPath,
      JSON.stringify({
        title: f.name ?? fileId,
        mime: f.mimeType ?? 'application/octet-stream',
        contentFingerprint: remoteFp,
      }),
      'utf8',
    )
    return {
      text,
      mime: f.mimeType ?? 'application/octet-stream',
      title: f.name ?? fileId,
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
