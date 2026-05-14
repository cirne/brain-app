/**
 * Authoritative Google Drive file read with disk cache (TTL: {@link REMOTE_DOCUMENT_BODY_CACHE_TTL_MS}).
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { REMOTE_DOCUMENT_BODY_CACHE_TTL_MS } from '../remoteDocumentBodyCache.js'
import { loadRipmailConfig } from './config.js'
import { createGoogleDriveClient } from './googleDrive.js'
import { extractDriveFileText } from './googleDriveFileContent.js'

function bodyCachePaths(ripmailHome: string, sourceId: string, fileId: string) {
  const h = createHash('sha256').update(`${sourceId}\0${fileId}`).digest('hex')
  const dir = join(ripmailHome, sourceId, 'cache', 'read-body')
  const path = join(dir, `${h}.txt`)
  return { dir, path, metaPath: `${path}.meta.json` }
}

export type GoogleDriveReadBodyOk = {
  text: string
  mime: string
  title: string
}

/** Fetch full text for a Drive file id; uses TTL cache under ripmail source dir. */
export async function readGoogleDriveFileBodyCached(
  ripmailHome: string,
  sourceId: string,
  fileId: string,
): Promise<GoogleDriveReadBodyOk | null> {
  const config = loadRipmailConfig(ripmailHome)
  const source = (config.sources ?? []).find((s) => s.id === sourceId)
  if (!source || source.kind !== 'googleDrive') return null

  const { dir, path, metaPath } = bodyCachePaths(ripmailHome, sourceId, fileId)
  const now = Date.now()
  if (existsSync(path) && existsSync(metaPath)) {
    try {
      const st = statSync(path)
      if (st.mtimeMs > now - REMOTE_DOCUMENT_BODY_CACHE_TTL_MS) {
        const cachedText = readFileSync(path, 'utf8')
        if (cachedText.trim().length > 0) {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { title?: string; mime?: string }
          return {
            text: cachedText,
            mime: typeof meta.mime === 'string' ? meta.mime : 'application/octet-stream',
            title: typeof meta.title === 'string' ? meta.title : fileId,
          }
        }
        try {
          unlinkSync(path)
          unlinkSync(metaPath)
        } catch {
          /* refetch without stale empty cache */
        }
      }
    } catch {
      /* refetch */
    }
  }

  const client = createGoogleDriveClient(ripmailHome, source)
  if (!client) return null

  const meta = await client.drive.files.get({
    fileId,
    fields: 'id, name, mimeType, modifiedTime, md5Checksum, size, headRevisionId, trashed',
    supportsAllDrives: true,
  })
  const f = meta.data
  if (!f.id || f.trashed) return null

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
