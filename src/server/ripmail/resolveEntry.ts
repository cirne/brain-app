/**
 * Resolve a ripmail corpus id to either mail (inbox viewer) or indexed file (Drive / localDir).
 * Prefer mail when `messages.message_id` matches — avoids misclassifying rare ID collisions.
 */
import { prepareRipmailDb } from './db.js'
import { readIndexedFileResultToViewerPayload, type IndexedFileViewerApiPayload } from './indexedEntryPayload.js'
import { readIndexedFile, readMailForDisplay } from './mailRead.js'

export type RipmailEntryMailJson = {
  entryKind: 'mail'
  messageId: string
  threadId: string
  headers: {
    from: string
    to: string[]
    cc: string[]
    subject: string
    date: string
  }
  bodyKind: 'html' | 'text'
  bodyText: string
  bodyHtml?: string
  visualArtifacts?: unknown[]
}

export type RipmailEntryResponseJson =
  | RipmailEntryMailJson
  | ({ entryKind: 'indexed-file' } & IndexedFileViewerApiPayload)

function mailDisplayToMailEntryJson(msg: NonNullable<ReturnType<typeof readMailForDisplay>>): RipmailEntryMailJson {
  return {
    entryKind: 'mail',
    messageId: msg.messageId,
    threadId: msg.threadId,
    headers: {
      from: msg.fromAddress,
      to: msg.toAddresses,
      cc: msg.ccAddresses,
      subject: msg.subject,
      date: msg.date,
    },
    bodyKind: msg.bodyKind,
    bodyText: msg.bodyText,
    ...(msg.bodyHtml ? { bodyHtml: msg.bodyHtml } : {}),
    ...(msg.visualArtifacts?.length ? { visualArtifacts: msg.visualArtifacts } : {}),
  }
}

export async function ripmailResolveEntryJson(
  ripmailHome: string,
  id: string,
  opts?: { sourceId?: string },
): Promise<RipmailEntryResponseJson | null> {
  const db = await prepareRipmailDb(ripmailHome)
  const mail = readMailForDisplay(db, ripmailHome, id)
  if (mail) {
    return mailDisplayToMailEntryJson(mail)
  }
  const indexed = await readIndexedFile(db, ripmailHome, id, {
    fullBody: true,
    sourceId: opts?.sourceId?.trim() || undefined,
  })
  if (!indexed) return null
  const normalized = readIndexedFileResultToViewerPayload(indexed, id.trim())
  if (!normalized) return null
  return { entryKind: 'indexed-file', ...normalized }
}
