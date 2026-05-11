/**
 * IMAP sync via imapflow — incremental UID-based fetch.
 * Mirrors ripmail/src/sync/ (Rust imap crate logic).
 */

import { ImapFlow } from 'imapflow'
import type { RipmailDb } from '../db.js'
import { writeEml } from './maildir.js'
import { parseEml } from './parse.js'
import {
  clearImapFolderMaildirAndMessages,
  persistMessage,
  updateSyncState,
  getSyncState,
  updateSourceLastSynced,
} from './persist.js'
import type { SourceConfig, GoogleOAuthTokens } from './config.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

const FETCH_BATCH_SIZE = 50

async function buildImapAuth(
  source: SourceConfig,
  password: string | undefined,
  oauthTokens: GoogleOAuthTokens | null,
): Promise<{ user: string; pass?: string; accessToken?: string }> {
  const user = source.email ?? source.imap?.user ?? ''
  if (source.imapAuth === 'googleOAuth' && oauthTokens?.accessToken) {
    return { user, accessToken: oauthTokens.accessToken }
  }
  return { user, pass: password ?? '' }
}

export interface ImapSyncResult {
  sourceId: string
  messagesAdded: number
  messagesUpdated: number
  folders: string[]
  error?: string
}

/**
 * Perform an incremental IMAP sync for one source.
 * Connects to IMAP, checks each folder, fetches new UIDs since last_uid, persists to DB.
 */
export async function syncImapSource(
  db: RipmailDb,
  ripmailHome: string,
  source: SourceConfig,
  password: string | undefined,
  oauthTokens: GoogleOAuthTokens | null,
  opts?: { excludeLabels?: string[]; abort?: AbortSignal },
): Promise<ImapSyncResult> {
  const sourceId = source.id
  const imapConfig = source.imap
  if (!imapConfig) {
    return { sourceId, messagesAdded: 0, messagesUpdated: 0, folders: [], error: 'No IMAP config' }
  }

  const auth = await buildImapAuth(source, password, oauthTokens)
  const client = new ImapFlow({
    host: imapConfig.host,
    port: imapConfig.port,
    secure: imapConfig.port === 993,
    auth,
    logger: false,
    tls: { rejectUnauthorized: false },
  })

  const result: ImapSyncResult = { sourceId, messagesAdded: 0, messagesUpdated: 0, folders: [] }
  const excludeLabels = new Set((opts?.excludeLabels ?? ['Trash', 'Spam']).map((l) => l.toLowerCase()))

  try {
    await client.connect()

    const mailboxList = await client.list()
    const foldersToSync = mailboxList
      .filter((mb) => !excludeLabels.has(mb.name.toLowerCase()))
      .map((mb) => mb.path)

    result.folders = foldersToSync

    for (const folder of foldersToSync) {
      if (opts?.abort?.aborted) break
      try {
        await syncFolder(db, ripmailHome, client, sourceId, folder, result, opts?.abort)
      } catch (e) {
        brainLogger.warn({ sourceId, folder, err: String(e) }, 'ripmail:imap:folder-sync-error')
      }
    }

    updateSourceLastSynced(db, sourceId)
  } catch (e) {
    result.error = String(e)
    brainLogger.error({ sourceId, err: String(e) }, 'ripmail:imap:sync-error')
  } finally {
    try {
      await client.logout()
    } catch {
      // ignore logout errors
    }
  }

  return result
}

async function syncFolder(
  db: RipmailDb,
  ripmailHome: string,
  client: ImapFlow,
  sourceId: string,
  folder: string,
  result: ImapSyncResult,
  abort?: AbortSignal,
): Promise<void> {
  const lock = await client.getMailboxLock(folder)
  try {
    const mailbox = client.mailbox
    if (!mailbox) return

    const uidvalidity = mailbox.uidValidity ? Number(mailbox.uidValidity) : 0
    const storedState = getSyncState(db, sourceId, folder)

    // Check UID validity — if changed, reset and re-sync from scratch
    let lastUid = 0
    if (storedState) {
      if (storedState.uidvalidity !== uidvalidity) {
        // UID validity changed — start fresh for this folder
        lastUid = 0
        clearImapFolderMaildirAndMessages(db, ripmailHome, sourceId, folder)
        brainLogger.info({ sourceId, folder, oldValidity: storedState.uidvalidity, newValidity: uidvalidity }, 'ripmail:imap:uidvalidity-changed')
      } else {
        lastUid = storedState.lastUid
      }
    }

    const uidRange = lastUid > 0 ? `${lastUid + 1}:*` : '1:*'
    const uids = await client.search({ uid: uidRange }, { uid: true })

    if (!uids || uids.length === 0) {
      updateSyncState(db, sourceId, folder, uidvalidity, mailbox.uidNext ? Number(mailbox.uidNext) - 1 : lastUid)
      return
    }

    let highestUid = lastUid
    let added = 0
    let updated = 0

    // Process in batches
    for (let i = 0; i < uids.length; i += FETCH_BATCH_SIZE) {
      if (abort?.aborted) break
      const batch = uids.slice(i, i + FETCH_BATCH_SIZE)
      const batchRange = batch.join(',')

      for await (const msg of client.fetch(batchRange, { uid: true, source: true, flags: true }, { uid: true })) {
        if (abort?.aborted) break
        const uid = Number(msg.uid)
        if (uid > highestUid) highestUid = uid

        const raw = msg.source
        if (!raw || raw.length === 0) continue

        const rawPath = (() => {
          try {
            return writeEml(ripmailHome, sourceId, folder, uidvalidity, uid, raw)
          } catch {
            return ''
          }
        })()

        const flags = msg.flags ?? new Set<string>()
        const labels: string[] = [...flags]

        try {
          const parsed = await parseEml(raw, rawPath, {
            folder,
            uid,
            sourceId,
            labels,
          })
          const isNew = !db.prepare(`SELECT 1 FROM messages WHERE message_id = ?`).get(`<${parsed.messageId}>`)
          persistMessage(db, parsed, ripmailHome)
          if (isNew) added++
          else updated++
        } catch (e) {
          brainLogger.warn({ sourceId, folder, uid, err: String(e) }, 'ripmail:imap:parse-error')
        }
      }
    }

    updateSyncState(db, sourceId, folder, uidvalidity, highestUid)
    result.messagesAdded += added
    result.messagesUpdated += updated
  } finally {
    lock.release()
  }
}
