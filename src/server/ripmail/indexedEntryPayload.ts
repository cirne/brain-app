import { deriveIndexedSourceAppUrl } from './deriveIndexedSourceAppUrl.js'
import type { ReadIndexedFileResult } from './types.js'

/** JSON shape for {@link IndexedFileViewer} / `GET /api/files/indexed` / indexed branch of entry resolver. */
export type IndexedFileViewerApiPayload = {
  id: string
  sourceKind: 'googleDrive' | 'localDir'
  title: string
  body: string
  mime: string
  readStatus: string
  /** ISO-ish or index-native timestamp for display; optional. */
  modifiedAt?: string
  /** Best-effort HTTPS URL to open the document in its source app (Drive, etc.). */
  sourceAppUrl?: string
}

export function readIndexedFileResultToViewerPayload(
  result: ReadIndexedFileResult,
  queryId: string,
): IndexedFileViewerApiPayload | null {
  const sk = result.sourceKind
  const mime = (result.mime ?? '').trim() || 'application/octet-stream'
  const modifiedAt = (result.modifiedAt ?? '').trim() || undefined
  const sourceAppUrl =
    deriveIndexedSourceAppUrl({
      sourceKind: sk,
      id: (result.id ?? queryId).trim(),
      mime: result.mime,
    }) ?? undefined

  if (sk === 'googleDrive') {
    const q = queryId.trim()
    return {
      id: q,
      sourceKind: 'googleDrive',
      title: (result.title ?? '').trim() || q,
      body: result.bodyText ?? '',
      mime,
      readStatus: 'ok',
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(sourceAppUrl ? { sourceAppUrl } : {}),
    }
  }
  if (sk === 'localDir') {
    const path = (result.id ?? '').trim() || queryId.trim()
    const title =
      (result.title ?? '').trim() ||
      path.split(/[/\\]/).filter(Boolean).pop() ||
      path
    return {
      id: path,
      sourceKind: 'localDir',
      title,
      body: result.bodyText ?? '',
      mime,
      readStatus: 'ok',
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(sourceAppUrl ? { sourceAppUrl } : {}),
    }
  }
  return null
}
