/**
 * Download / export Google Drive files to plain text (sync + read-on-demand).
 */

import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { drive_v3 } from 'googleapis'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { extractAttachmentText } from '../attachments.js'

const DRIVE_HTTP_TIMEOUT_MS = 120_000
const defaultDriveHttpOpts = { timeout: DRIVE_HTTP_TIMEOUT_MS }

/**
 * For sync-time `alt=media` downloads: use HTTP Range for the first N bytes when the file is
 * larger or size is unknown. Full-file fetch remains the default when this is omitted (e.g.
 * read-on-demand). Truncated binaries may extract poorly (PDFs); indexing still stays bounded.
 */
export const DRIVE_SYNC_MAX_BINARY_DOWNLOAD_BYTES = 15 * 1024 * 1024

export const GOOGLE_DRIVE_NATIVE_MIMES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
  'application/vnd.google-apps.form',
])

export function exportMimeForGoogleNative(mime: string | null | undefined): string | null {
  if (!mime) return null
  if (mime === 'application/vnd.google-apps.document') return 'text/plain'
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'text/csv'
  if (mime === 'application/vnd.google-apps.presentation') return 'text/plain'
  if (mime === 'application/vnd.google-apps.drawing') return 'image/png'
  return null
}

async function writeMediaToPath(
  drive: drive_v3.Drive,
  fileId: string,
  destPath: string,
  httpOpts: { timeout?: number },
  maxDownloadBytes?: number,
): Promise<void> {
  const headers: Record<string, string> = {}
  if (maxDownloadBytes != null && maxDownloadBytes > 0) {
    headers.Range = `bytes=0-${maxDownloadBytes - 1}`
  }
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    {
      ...httpOpts,
      responseType: 'arraybuffer',
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    },
  )
  let buf = Buffer.from(res.data as ArrayBuffer)
  if (maxDownloadBytes != null && maxDownloadBytes > 0 && buf.length > maxDownloadBytes) {
    buf = buf.subarray(0, maxDownloadBytes)
  }
  writeFileSync(destPath, buf)
}

async function exportGoogleFileToPath(
  drive: drive_v3.Drive,
  fileId: string,
  mime: string,
  destPath: string,
  httpOpts: { timeout?: number },
): Promise<boolean> {
  const exportMime = exportMimeForGoogleNative(mime)
  if (!exportMime) return false
  try {
    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { ...httpOpts, responseType: 'arraybuffer' },
    )
    writeFileSync(destPath, Buffer.from(res.data as ArrayBuffer))
    return true
  } catch (e) {
    brainLogger.warn({ fileId, mime, err: String(e) }, 'ripmail:drive:export-failed')
    return false
  }
}

export type ExtractDriveFileTextOpts = {
  /**
   * When set, binary `alt=media` fetches use at most this many bytes (HTTP Range) if the Drive
   * `size` is unknown or larger than this cap; smaller files still download whole object.
   */
  maxBinaryDownloadBytes?: number
}

/** Full export/download + text extraction for one Drive file (uses temp files under workDir). */
export async function extractDriveFileText(
  drive: drive_v3.Drive,
  f: drive_v3.Schema$File,
  workDir: string,
  httpOpts: { timeout?: number } = defaultDriveHttpOpts,
  extractOpts?: ExtractDriveFileTextOpts,
): Promise<string> {
  const req = { timeout: httpOpts.timeout ?? DRIVE_HTTP_TIMEOUT_MS }
  const cap = extractOpts?.maxBinaryDownloadBytes
  const mime = f.mimeType ?? 'application/octet-stream'
  const name = (f.name ?? 'file').replace(/[/\\]/g, '_')
  const id = f.id ?? 'unknown'

  if (mime === 'application/vnd.google-apps.folder') return ''

  if (GOOGLE_DRIVE_NATIVE_MIMES.has(mime)) {
    const ext =
      mime === 'application/vnd.google-apps.spreadsheet'
        ? '.csv'
        : mime === 'application/vnd.google-apps.drawing'
          ? '.png'
          : '.txt'
    const path = join(workDir, `${id}${ext}`)
    const ok = await exportGoogleFileToPath(drive, id, mime, path, req)
    if (!ok) return ''
    try {
      const inferredMime =
        mime === 'application/vnd.google-apps.spreadsheet'
          ? 'text/csv'
          : mime === 'application/vnd.google-apps.drawing'
            ? 'image/png'
            : 'text/plain'
      return await extractAttachmentText(path, inferredMime)
    } finally {
      try {
        unlinkSync(path)
      } catch {
        /* ignore */
      }
    }
  }

  const path = join(workDir, `${id}-${name}`)
  try {
    const known = Number(f.size ?? 0)
    let maxDownloadBytes: number | undefined
    if (cap != null && cap > 0) {
      maxDownloadBytes = known === 0 || known > cap ? cap : undefined
    }
    await writeMediaToPath(drive, id, path, req, maxDownloadBytes)
    return await extractAttachmentText(path, mime)
  } catch (e) {
    brainLogger.warn({ fileId: id, err: String(e) }, 'ripmail:drive:download-failed')
    return ''
  } finally {
    try {
      unlinkSync(path)
    } catch {
      /* ignore */
    }
  }
}
