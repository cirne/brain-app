import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from 'hono'
import {
  buildReadPathAllowlist,
  isAgentReadPathAllowed,
} from '@server/lib/chat/agentPathPolicy.js'
import {
  encodeVisualArtifactRef,
  VISUAL_ARTIFACT_MAX_BYTES,
  visualArtifactKindForMimeOrName,
  visualArtifactReadStatus,
  type VisualArtifact,
  type VisualArtifactRefPayload,
} from '@shared/visualArtifacts.js'
import type { RipmailDb } from './db.js'
import type { AttachmentMeta, ReadIndexedFileResult } from './types.js'

type AttachmentArtifactRow = {
  id: number
  message_id: string
  filename: string
  mime_type: string
  size: number
  stored_path: string
}

type IndexedFileArtifactRow = {
  abs_path: string
  rel_path: string
  source_id: string
  source_kind: string | null
  title: string | null
  mime: string | null
  size: number
}

function resolveMessageId(db: RipmailDb, messageId: string): string | null {
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
  return null
}

function attachmentAbsPath(storedPath: string, ripmailHome: string): string {
  return storedPath.startsWith('/') ? storedPath : join(ripmailHome, storedPath)
}

function artifactFromAttachmentMeta(messageId: string, attachment: AttachmentMeta): VisualArtifact | null {
  const kind = visualArtifactKindForMimeOrName(attachment.mimeType, attachment.filename)
  if (!kind) return null
  const status = visualArtifactReadStatus(attachment.size)
  return {
    kind,
    mime: attachment.mimeType || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
    ref:
      status === 'available'
        ? encodeVisualArtifactRef({
            v: 1,
            type: 'mailAttachment',
            messageId,
            attachmentIndex: attachment.index,
          })
        : undefined,
    label: attachment.filename || `Attachment ${attachment.index}`,
    origin: {
      kind: 'mailAttachment',
      messageId,
      attachmentIndex: attachment.index,
      attachmentId: attachment.id,
      filename: attachment.filename,
    },
    readStatus: status,
    size: attachment.size,
    ...(status === 'too_large' ? { error: `Attachment exceeds ${VISUAL_ARTIFACT_MAX_BYTES} byte visual preview limit.` } : {}),
  }
}

export function visualArtifactsFromAttachments(messageId: string, attachments: AttachmentMeta[] | undefined): VisualArtifact[] {
  if (!attachments?.length) return []
  return attachments.flatMap((attachment) => {
    const artifact = artifactFromAttachmentMeta(messageId, attachment)
    return artifact ? [artifact] : []
  })
}

export function visualArtifactFromIndexedFileResult(result: ReadIndexedFileResult | null): VisualArtifact[] {
  if (!result) return []
  const mime = result.mime ?? ''
  const kind = visualArtifactKindForMimeOrName(mime, result.title || result.id)
  if (!kind) return []
  const hasResolvableBytes = typeof result.size === 'number'
  const status = hasResolvableBytes ? visualArtifactReadStatus(result.size) : 'missing'
  return [
    {
      kind,
      mime: mime || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
      ref:
        status === 'available' && hasResolvableBytes
          ? encodeVisualArtifactRef({
              v: 1,
              type: 'indexedFile',
              id: result.id,
            })
          : undefined,
      label: result.title || result.id,
      origin: {
        kind: 'indexedFile',
        id: result.id,
        sourceKind: result.sourceKind,
        title: result.title || result.id,
      },
      readStatus: status,
      ...(typeof result.size === 'number' ? { size: result.size } : {}),
      ...(status === 'too_large' ? { error: `File exceeds ${VISUAL_ARTIFACT_MAX_BYTES} byte visual preview limit.` } : {}),
      ...(status === 'missing' ? { error: 'Indexed source did not provide cached bytes for visual preview.' } : {}),
    },
  ]
}

function mailAttachmentRowForRef(db: RipmailDb, payload: Extract<VisualArtifactRefPayload, { type: 'mailAttachment' }>): AttachmentArtifactRow | null {
  const resolvedId = resolveMessageId(db, payload.messageId)
  if (!resolvedId) return null
  const rows = db
    .prepare(
      `SELECT id, message_id, filename, mime_type, size, stored_path
       FROM attachments WHERE message_id = ? ORDER BY id`,
    )
    .all(resolvedId) as AttachmentArtifactRow[]
  return rows[payload.attachmentIndex - 1] ?? null
}

function indexedFileRowForRef(db: RipmailDb, payload: Extract<VisualArtifactRefPayload, { type: 'indexedFile' }>): IndexedFileArtifactRow | null {
  return db
    .prepare(
      `SELECT f.abs_path, f.rel_path, f.source_id, f.title, f.mime, f.size, s.kind AS source_kind
       FROM files f
       LEFT JOIN sources s ON s.id = f.source_id
       WHERE f.abs_path = ? OR f.rel_path = ?
       LIMIT 1`,
    )
    .get(payload.id, payload.id) as IndexedFileArtifactRow | null
}

function artifactBytesResponse(c: Context, absPath: string, mime: string, size: number): Response {
  if (!existsSync(absPath)) return c.json({ error: 'artifact file not found' }, 404)
  if (size > VISUAL_ARTIFACT_MAX_BYTES) return c.json({ error: 'artifact too large' }, 413)
  const body = readFileSync(absPath)
  return c.body(body, 200, {
    'Content-Type': mime || 'application/octet-stream',
    'Content-Length': String(body.byteLength),
    'Cache-Control': 'private, max-age=300',
  })
}

export async function resolveVisualArtifactResponse(c: Context, db: RipmailDb, ripmailHome: string, payload: VisualArtifactRefPayload): Promise<Response> {
  if (payload.type === 'mailAttachment') {
    const row = mailAttachmentRowForRef(db, payload)
    if (!row) return c.json({ error: 'artifact not found' }, 404)
    const kind = visualArtifactKindForMimeOrName(row.mime_type, row.filename)
    if (!kind) return c.json({ error: 'artifact is not visual media' }, 415)
    const absPath = attachmentAbsPath(row.stored_path, ripmailHome)
    let size = row.size
    try {
      size = statSync(absPath).size
    } catch {
      /* use DB size for error shaping */
    }
    return artifactBytesResponse(c, absPath, row.mime_type, size)
  }

  const row = indexedFileRowForRef(db, payload)
  if (!row) return c.json({ error: 'artifact not found' }, 404)
  const allow = await buildReadPathAllowlist()
  if (!isAgentReadPathAllowed(row.abs_path, allow)) {
    return c.json({ error: 'path not allowed for this tenant' }, 403)
  }
  const title = row.title || row.rel_path || row.abs_path
  const kind = visualArtifactKindForMimeOrName(row.mime ?? '', title)
  if (!kind) return c.json({ error: 'artifact is not visual media' }, 415)
  return artifactBytesResponse(c, row.abs_path, row.mime || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'), row.size)
}
