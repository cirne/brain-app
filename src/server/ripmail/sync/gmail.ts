/**
 * Gmail incremental sync via history.list + messages.get.
 * Mirrors ripmail/src/sync/ Gmail path.
 *
 * Uses the googleapis npm package.
 */

import { google } from 'googleapis'
import type { RipmailDb } from '../db.js'
import { writeEml } from './maildir.js'
import { parseEml } from './parse.js'
import { persistMessage, getSyncState, updateSyncState, updateSourceLastSynced } from './persist.js'
import type { GoogleOAuthTokens } from './config.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export interface GmailSyncResult {
  sourceId: string
  messagesAdded: number
  messagesUpdated: number
  error?: string
}

/** Map a Gmail label to a ripmail category. */
function labelToCategory(labels: string[]): string | undefined {
  const lower = labels.map((l) => l.toLowerCase())
  if (lower.includes('\\promotions') || lower.includes('promotions')) return 'promotional'
  if (lower.includes('\\social') || lower.includes('social')) return 'social'
  if (lower.includes('\\forums') || lower.includes('forums')) return 'forum'
  if (lower.includes('\\spam') || lower.includes('spam') || lower.includes('junk')) return 'spam'
  if (lower.includes('bulk')) return 'bulk'
  return undefined
}

function buildOAuthClient(tokens: GoogleOAuthTokens, envClientId?: string, envClientSecret?: string) {
  const clientId = tokens.clientId ?? envClientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = tokens.clientSecret ?? envClientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  })
  return oauth2
}

export async function syncGmailSource(
  db: RipmailDb,
  ripmailHome: string,
  sourceId: string,
  email: string,
  tokens: GoogleOAuthTokens,
  opts?: { abort?: AbortSignal },
): Promise<GmailSyncResult> {
  const result: GmailSyncResult = { sourceId, messagesAdded: 0, messagesUpdated: 0 }

  const auth = buildOAuthClient(tokens)
  if (!auth) {
    result.error = 'No OAuth client credentials available for Gmail sync'
    return result
  }

  const gmail = google.gmail({ version: 'v1', auth })

  try {
    // Check for stored history ID for incremental sync
    const storedState = getSyncState(db, sourceId, 'INBOX')
    const historyId = storedState?.gmailHistoryId

    let messageIds: string[]

    if (historyId) {
      // Incremental: use history.list
      try {
        const historyResp = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: historyId,
          historyTypes: ['messageAdded'],
        })
        const added = historyResp.data.history?.flatMap((h) => h.messagesAdded ?? []) ?? []
        messageIds = added.map((m) => m.message?.id ?? '').filter(Boolean)
      } catch {
        // History expired — fall back to full list (last 7 days)
        messageIds = await listRecentMessageIds(gmail)
      }
    } else {
      // Initial sync: list recent messages
      messageIds = await listRecentMessageIds(gmail)
    }

    // Fetch each message
    let highestHistoryId = historyId ?? '0'
    for (const msgId of messageIds) {
      if (opts?.abort?.aborted) break
      try {
        const msgResp = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'raw',
        })
        const raw = msgResp.data.raw
        if (!raw) continue

        const rawBuf = Buffer.from(raw, 'base64url')
        const uid = parseInt(msgId, 10) || 0
        const labels = msgResp.data.labelIds ?? []
        const category = labelToCategory(labels)

        const rawPath = writeEml(ripmailHome, sourceId, 'INBOX', uid, rawBuf)
        const parsed = await parseEml(rawBuf, rawPath, {
          folder: 'INBOX',
          uid,
          sourceId,
          labels,
          category,
        })

        const isNew = !db.prepare(`SELECT 1 FROM messages WHERE message_id = ?`).get(`<${parsed.messageId}>`)
        persistMessage(db, parsed, ripmailHome)
        if (isNew) result.messagesAdded++
        else result.messagesUpdated++

        // Track highest history ID
        if (msgResp.data.historyId && BigInt(msgResp.data.historyId) > BigInt(highestHistoryId)) {
          highestHistoryId = msgResp.data.historyId
        }
      } catch (e) {
        brainLogger.warn({ sourceId, msgId, err: String(e) }, 'ripmail:gmail:message-fetch-error')
      }
    }

    // Persist final history ID
    const finalHistory = await gmail.users.getProfile({ userId: 'me' })
    const newHistoryId = finalHistory.data.historyId ?? highestHistoryId
    updateSyncState(db, sourceId, 'INBOX', 0, 0, String(newHistoryId))
    updateSourceLastSynced(db, sourceId)
  } catch (e) {
    result.error = String(e)
    brainLogger.error({ sourceId, err: String(e) }, 'ripmail:gmail:sync-error')
  }

  return result
}

async function listRecentMessageIds(gmail: ReturnType<typeof google.gmail>): Promise<string[]> {
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 86_400_000) / 1000)
  const resp = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${sevenDaysAgo}`,
    maxResults: 500,
  })
  return (resp.data.messages ?? []).map((m) => m.id ?? '').filter(Boolean)
}
