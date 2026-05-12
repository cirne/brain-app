export const VISUAL_ARTIFACT_REF_VERSION = 1
export const VISUAL_ARTIFACT_MAX_BYTES = 25 * 1024 * 1024

export type VisualArtifactKind = 'image' | 'pdf'
export type VisualArtifactReadStatus = 'available' | 'too_large' | 'missing' | 'unsupported'

export type VisualArtifactOrigin =
  | {
      kind: 'mailAttachment'
      messageId: string
      attachmentIndex: number
      attachmentId?: number
      filename: string
    }
  | {
      kind: 'indexedFile'
      id: string
      sourceKind: string
      title: string
    }

export type VisualArtifact = {
  kind: VisualArtifactKind
  mime: string
  ref?: string
  label: string
  origin: VisualArtifactOrigin
  readStatus: VisualArtifactReadStatus
  size?: number
  width?: number
  height?: number
  pageIndex?: number
  error?: string
}

export type VisualArtifactRefPayload =
  | {
      v: typeof VISUAL_ARTIFACT_REF_VERSION
      type: 'mailAttachment'
      messageId: string
      attachmentIndex: number
    }
  | {
      v: typeof VISUAL_ARTIFACT_REF_VERSION
      type: 'indexedFile'
      id: string
    }

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i
const PDF_EXT_RE = /\.pdf$/i

function bytesToBinary(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += String.fromCharCode(b)
  return out
}

function binaryToBytes(binary: string): Uint8Array {
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function base64UrlEncode(value: string): string {
  return btoa(bytesToBinary(new TextEncoder().encode(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return new TextDecoder().decode(binaryToBytes(atob(padded)))
}

export function visualArtifactKindForMimeOrName(mimeType: string | undefined, name: string): VisualArtifactKind | null {
  const mime = (mimeType ?? '').trim().toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (IMAGE_EXT_RE.test(name)) return 'image'
  if (PDF_EXT_RE.test(name)) return 'pdf'
  return null
}

export function visualArtifactReadStatus(size: number | undefined): VisualArtifactReadStatus {
  return typeof size === 'number' && size > VISUAL_ARTIFACT_MAX_BYTES ? 'too_large' : 'available'
}

export function encodeVisualArtifactRef(payload: VisualArtifactRefPayload): string {
  const json = JSON.stringify(payload)
  return `va1.${base64UrlEncode(json)}`
}

/** Strip whitespace/newlines models sometimes inject when copying `va1…` tokens. */
function normalizeVisualArtifactRefInput(ref: string): string {
  return ref.trim().replace(/\s+/g, '')
}

function parseAttachmentIndexLoose(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw >= 1 ? raw : null
  if (typeof raw === 'string') {
    const n = parseInt(raw.trim(), 10)
    if (Number.isSafeInteger(n) && n >= 1) return n
  }
  return null
}

/**
 * After JSON.parse, normalize LLM-mangled shapes (typo keys, string indices) into {@link VisualArtifactRefPayload}.
 */
function normalizeVisualArtifactRefPayload(parsed: unknown): VisualArtifactRefPayload | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  if (o.v !== VISUAL_ARTIFACT_REF_VERSION) return null
  const type = o.type
  if (type === 'indexedFile' && typeof o.id === 'string') {
    const id = o.id.trim()
    if (!id) return null
    return { v: VISUAL_ARTIFACT_REF_VERSION, type: 'indexedFile', id }
  }
  if (type === 'mailAttachment') {
    const messageId = typeof o.messageId === 'string' ? o.messageId.trim() : ''
    if (!messageId) return null
    const attachmentIndex =
      parseAttachmentIndexLoose(o.attachmentIndex) ??
      parseAttachmentIndexLoose(o.attachment_index) ??
      parseAttachmentIndexLoose(o.attacmentIndex)
    if (attachmentIndex == null) return null
    return {
      v: VISUAL_ARTIFACT_REF_VERSION,
      type: 'mailAttachment',
      messageId,
      attachmentIndex,
    }
  }
  return null
}

export function decodeVisualArtifactRef(ref: string): VisualArtifactRefPayload | null {
  const normalized = normalizeVisualArtifactRefInput(ref)
  if (!normalized.startsWith('va1.')) return null
  try {
    const payload = JSON.parse(base64UrlDecode(normalized.slice(4)))
    return normalizeVisualArtifactRefPayload(payload)
  } catch {
    return null
  }
}

export function visualArtifactFetchUrl(ref: string): string {
  return `/api/files/artifact?ref=${encodeURIComponent(ref)}`
}
