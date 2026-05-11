/**
 * Gmail incremental sync via history.list + messages.get.
 * Mirrors ripmail/src/sync/ Gmail path.
 *
 * Uses the googleapis npm package.
 */

import { google } from 'googleapis'
import pLimit from 'p-limit'
import type { RipmailDb } from '../db.js'
import { writeEml } from './maildir.js'
import { parseEml } from './parse.js'
import {
  persistMessage,
  getSyncState,
  updateSyncState,
  updateSourceLastSynced,
  markFirstBackfillCompleted,
} from './persist.js'
import type { GoogleOAuthTokens } from './config.js'
import type { RipmailHistoricalSince } from '../types.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export interface GmailSyncResult {
  sourceId: string
  messagesAdded: number
  messagesUpdated: number
  error?: string
}

/** Cap Gmail messages.list pagination per refresh (500 ids/page). */
export const GMAIL_HISTORICAL_LIST_MAX_PAGES = 100

/** Max concurrent `users.messages.get` calls during Gmail sync. */
export const GMAIL_MESSAGES_GET_CONCURRENCY = 8

const DAY_SEC = 86_400

/**
 * Map items through `fn` with at most `concurrency` in-flight async operations.
 * Exported for unit tests (same semantics as the Gmail fetch pool).
 */
export async function runWithConcurrencyPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const limit = pLimit(concurrency)
  return Promise.all(items.map((item) => limit(() => fn(item))))
}

/** Lower bound for Gmail `after:` search (epoch seconds), inclusive window. */
export function historicalSinceToAfterEpochSeconds(spec: string): number {
  const s = spec.trim().toLowerCase()
  let days: number
  switch (s) {
    case '30d':
      days = 30
      break
    case '90d':
      days = 90
      break
    case '180d':
      days = 180
      break
    case '1y':
      days = 365
      break
    case '2y':
      days = 2 * 365
      break
    default:
      throw new Error(`invalid historicalSince: ${spec}`)
  }
  return Math.floor(Date.now() / 1000) - days * DAY_SEC
}

function isHistoricalSince(v: string | undefined): v is RipmailHistoricalSince {
  return v === '30d' || v === '90d' || v === '180d' || v === '1y' || v === '2y'
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

async function listHistoricalMessageIds(
  gmail: ReturnType<typeof google.gmail>,
  afterEpochSec: number,
  abort: AbortSignal | undefined,
): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  let pages = 0
  const q = `after:${afterEpochSec}`
  while (pages < GMAIL_HISTORICAL_LIST_MAX_PAGES) {
    if (abort?.aborted) break
    const resp = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: 500,
      pageToken,
    })
    const batch = (resp.data.messages ?? []).map((m) => m.id ?? '').filter(Boolean)
    ids.push(...batch)
    pageToken = resp.data.nextPageToken ?? undefined
    if (!pageToken) break
    pages++
  }
  return ids
}

async function listRecentMessageIds(gmail: ReturnType<typeof google.gmail>): Promise<string[]> {
  const sevenDaysAgo = Math.floor((Date.now() - 7 * DAY_SEC * 1000) / 1000)
  const resp = await gmail.users.messages.list({
    userId: 'me',
    q: `after:${sevenDaysAgo}`,
    maxResults: 500,
  })
  return (resp.data.messages ?? []).map((m) => m.id ?? '').filter(Boolean)
}

export async function syncGmailSource(
  db: RipmailDb,
  ripmailHome: string,
  sourceId: string,
  _email: string,
  tokens: GoogleOAuthTokens,
  opts?: { abort?: AbortSignal; historicalSince?: RipmailHistoricalSince },
): Promise<GmailSyncResult> {
  const result: GmailSyncResult = { sourceId, messagesAdded: 0, messagesUpdated: 0 }

  const auth = buildOAuthClient(tokens)
  if (!auth) {
    result.error = 'No OAuth client credentials available for Gmail sync'
    return result
  }

  const gmail = google.gmail({ version: 'v1', auth })

  try {
    const storedState = getSyncState(db, sourceId, 'INBOX')
    const historyId = storedState?.gmailHistoryId

    let messageIds: string[]
    const hist = opts?.historicalSince

    if (hist && isHistoricalSince(hist)) {
      const afterEpoch = historicalSinceToAfterEpochSeconds(hist)
      messageIds = await listHistoricalMessageIds(gmail, afterEpoch, opts?.abort)
      brainLogger.info(
        { sourceId, historicalSince: hist, listedIds: messageIds.length },
        'ripmail:gmail:historical-list',
      )
    } else if (historyId) {
      try {
        const historyResp = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: historyId,
          historyTypes: ['messageAdded'],
        })
        const added = historyResp.data.history?.flatMap((h) => h.messagesAdded ?? []) ?? []
        messageIds = added.map((m) => m.message?.id ?? '').filter(Boolean)
      } catch {
        messageIds = await listRecentMessageIds(gmail)
      }
    } else {
      messageIds = await listRecentMessageIds(gmail)
    }

    let highestHistoryId = historyId ?? '0'
    await runWithConcurrencyPool(messageIds, GMAIL_MESSAGES_GET_CONCURRENCY, async (msgId) => {
      if (opts?.abort?.aborted) return
      try {
        const msgResp = await gmail.users.messages.get({
          userId: 'me',
          id: msgId,
          format: 'raw',
        })
        if (opts?.abort?.aborted) return
        const raw = msgResp.data.raw
        if (!raw) return

        const rawBuf = Buffer.from(raw, 'base64url')
        const uid = parseInt(msgId, 10) || 0
        const labels = msgResp.data.labelIds ?? []
        const category = labelToCategory(labels)

        const rawPath = writeEml(ripmailHome, sourceId, 'INBOX', 0, uid, rawBuf)
        const parsed = await parseEml(rawBuf, rawPath, {
          folder: 'INBOX',
          uid,
          sourceId,
          labels,
          category,
        })
        if (opts?.abort?.aborted) return

        const isNew = !db.prepare(`SELECT 1 FROM messages WHERE message_id = ?`).get(`<${parsed.messageId}>`)
        persistMessage(db, parsed, ripmailHome)
        if (isNew) result.messagesAdded++
        else result.messagesUpdated++

        if (msgResp.data.historyId && BigInt(msgResp.data.historyId) > BigInt(highestHistoryId)) {
          highestHistoryId = msgResp.data.historyId
        }
      } catch (e) {
        brainLogger.warn({ sourceId, msgId, err: String(e) }, 'ripmail:gmail:message-fetch-error')
      }
    })

    const finalHistory = await gmail.users.getProfile({ userId: 'me' })
    const newHistoryId = finalHistory.data.historyId ?? highestHistoryId
    updateSyncState(db, sourceId, 'INBOX', 0, 0, String(newHistoryId))
    updateSourceLastSynced(db, sourceId)

    if ((hist === '1y' || hist === '2y') && !result.error) {
      markFirstBackfillCompleted(db, sourceId)
    }
  } catch (e) {
    result.error = String(e)
    brainLogger.error({ sourceId, err: String(e) }, 'ripmail:gmail:sync-error')
  }

  return result
}
