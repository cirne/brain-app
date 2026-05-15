/**
 * Derive a user-facing "open in original app" URL from ripmail index rows.
 * Persisted later per-provider URLs can replace or override this.
 */

/** Typical Drive file id (file, Doc, Sheet, …). Avoid deriving for obviously invalid ids. */
const GOOGLE_DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{10,100}$/

export function looksLikeGoogleDriveFileId(id: string): boolean {
  return GOOGLE_DRIVE_FILE_ID_RE.test(id.trim())
}

/**
 * Best-effort open URL for a Drive-backed indexed document.
 * Uses MIME when known so Docs/Sheets/Slides open in the editor.
 */
export function deriveGoogleDriveOpenUrl(fileId: string, mime?: string): string | null {
  const id = fileId.trim()
  if (!looksLikeGoogleDriveFileId(id)) return null

  const m = (mime ?? '').toLowerCase()
  const enc = encodeURIComponent(id)

  switch (m) {
    case 'application/vnd.google-apps.document':
      return `https://docs.google.com/document/d/${enc}/edit`
    case 'application/vnd.google-apps.spreadsheet':
      return `https://docs.google.com/spreadsheets/d/${enc}/edit`
    case 'application/vnd.google-apps.presentation':
      return `https://docs.google.com/presentation/d/${enc}/edit`
    case 'application/vnd.google-apps.drawing':
      return `https://docs.google.com/drawings/d/${enc}/edit`
    case 'application/vnd.google-apps.form':
      return `https://docs.google.com/forms/d/${enc}/edit`
    case 'application/vnd.google-apps.shortcut':
      // Shortcut target id differs from listing id — opening Drive UI is still useful.
      return `https://drive.google.com/file/d/${enc}/view`
    case 'application/vnd.google-apps.folder':
      return `https://drive.google.com/drive/folders/${enc}`
    default:
      return `https://drive.google.com/file/d/${enc}/view`
  }
}

export function deriveIndexedSourceAppUrl(opts: {
  sourceKind: string
  id: string
  mime?: string
}): string | null {
  const kind = opts.sourceKind.trim()
  if (kind === 'googleDrive') {
    return deriveGoogleDriveOpenUrl(opts.id, opts.mime)
  }
  return null
}
