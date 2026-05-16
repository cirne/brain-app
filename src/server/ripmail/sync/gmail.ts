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
import {
  persistMessage,
  getSyncState,
  updateSyncState,
  updateSourceLastSynced,
  markFirstBackfillCompleted,
  setBackfillListedTarget,
} from './persist.js'
import type { GoogleOAuthTokens } from './config.js'
import type { RipmailHistoricalSince } from '../types.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import {
  GMAIL_BACKFILL_MESSAGES_GET_CONCURRENCY,
  GMAIL_MESSAGES_GET_CONCURRENCY,
  runWithConcurrencyPool,
} from './syncConcurrency.js'
import {
  createBackfillQuotaBucket,
  GMAIL_MESSAGES_GET_QUOTA_UNITS,
  isGmailQuotaError,
  withGmailRetry,
  type GmailQuotaTokenBucket,
} from './gmailRateLimit.js'

export { GMAIL_MESSAGES_GET_CONCURRENCY, runWithConcurrencyPool } from './syncConcurrency.js'
export { GMAIL_BACKFILL_MESSAGES_GET_CONCURRENCY } from './syncConcurrency.js'

export interface GmailSyncResult {
  sourceId: string
  messagesAdded: number
  messagesUpdated: number
  error?: string
  /** Count of message fetches that failed (per-message catch); used for partial-failure surfacing. */
  fetchFailures?: number
  /** Listed message IDs in this run (backfill / bootstrap list phases). */
  listedCount?: number
}

/** Cap Gmail messages.list pagination per refresh (500 ids/page). */
export const GMAIL_HISTORICAL_LIST_MAX_PAGES = 100

/** Brief pause between backfill list pages to spread quota. */
const BACKFILL_INTER_PAGE_PAUSE_MS = 250

/** `markFirstBackfillCompleted` only when failure share is at or below this (0 = all must succeed). */
export const BACKFILL_COMPLETE_MAX_FAILURE_RATE = 0

const DAY_SEC = 86_400
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

function interPagePause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

type GmailClient = ReturnType<typeof google.gmail>

async function listHistoricalMessageIds(
  gmail: GmailClient,
  afterEpochSec: number,
  abort: AbortSignal | undefined,
  lane: 'refresh' | 'backfill' = 'refresh',
): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  let pages = 0
  const q = `after:${afterEpochSec}`
  while (pages < GMAIL_HISTORICAL_LIST_MAX_PAGES) {
    if (abort?.aborted) break
    const resp = await withGmailRetry(
      () =>
        gmail.users.messages.list({
          userId: 'me',
          q,
          maxResults: 500,
          pageToken,
        }),
      { lane },
    )
    const batch = (resp.data.messages ?? []).map((m) => m.id ?? '').filter(Boolean)
    ids.push(...batch)
    pageToken = resp.data.nextPageToken ?? undefined
    if (!pageToken) break
    pages++
  }
  return ids
}

/** Gmail bootstrap when `historyId` is missing: list IDs over a wide window (same span as `1y` backfill), paginated. */
async function listBootstrapMessageIdsWithoutHistory(
  gmail: GmailClient,
  abort: AbortSignal | undefined,
): Promise<string[]> {
  const afterEpoch = historicalSinceToAfterEpochSeconds('1y')
  return listHistoricalMessageIds(gmail, afterEpoch, abort, 'refresh')
}

type FetchContext = {
  db: RipmailDb
  ripmailHome: string
  sourceId: string
  lane: 'refresh' | 'backfill'
  abort?: AbortSignal
  gmail: GmailClient
  result: GmailSyncResult
  quotaBucket?: GmailQuotaTokenBucket
  getConcurrency: number
}

async function gmailMessagesGetRaw(
  ctx: FetchContext,
  msgId: string,
): Promise<{ raw: string; labelIds: string[]; historyId?: string | null }> {
  if (ctx.quotaBucket) {
    await ctx.quotaBucket.acquire(GMAIL_MESSAGES_GET_QUOTA_UNITS)
  }
  const msgResp = await withGmailRetry(
    () =>
      ctx.gmail.users.messages.get({
        userId: 'me',
        id: msgId,
        format: 'raw',
      }),
    { lane: ctx.lane },
  )
  const raw = msgResp.data.raw
  if (!raw) {
    throw new Error('Gmail message missing raw payload')
  }
  return {
    raw,
    labelIds: msgResp.data.labelIds ?? [],
    historyId: msgResp.data.historyId,
  }
}

async function fetchAndPersistMessage(
  ctx: FetchContext,
  msgId: string,
  highestHistoryId: { value: string },
): Promise<'ok' | 'failed'> {
  if (ctx.abort?.aborted) return 'ok'
  try {
    const { raw, labelIds, historyId } = await gmailMessagesGetRaw(ctx, msgId)
    if (ctx.abort?.aborted) return 'ok'

    const rawBuf = Buffer.from(raw, 'base64url')
    const uid = parseInt(msgId, 10) || 0
    const category = labelToCategory(labelIds)

    const rawPath = writeEml(ctx.ripmailHome, ctx.sourceId, 'INBOX', 0, uid, rawBuf)
    const parsed = await parseEml(rawBuf, rawPath, {
      folder: 'INBOX',
      uid,
      sourceId: ctx.sourceId,
      labels: labelIds,
      category,
    })
    if (ctx.abort?.aborted) return 'ok'

    const isNew = !ctx.db
      .prepare(`SELECT 1 FROM messages WHERE message_id = ?`)
      .get(`<${parsed.messageId}>`)
    persistMessage(ctx.db, parsed, ctx.ripmailHome)
    if (isNew) ctx.result.messagesAdded++
    else ctx.result.messagesUpdated++

    if (historyId && BigInt(historyId) > BigInt(highestHistoryId.value)) {
      highestHistoryId.value = historyId
    }
    return 'ok'
  } catch (e) {
    const quotaExhausted = isGmailQuotaError(e)
    brainLogger.warn(
      {
        sourceId: ctx.sourceId,
        lane: ctx.lane,
        msgId,
        quotaExhausted,
        err: String(e),
      },
      'ripmail:gmail:message-fetch-error',
    )
    return 'failed'
  }
}

async function fetchMessageIds(
  ctx: FetchContext,
  messageIds: string[],
  concurrency: number,
  highestHistoryId: { value: string },
): Promise<number> {
  let fetchFailures = 0
  await runWithConcurrencyPool(messageIds, concurrency, async (msgId) => {
    const outcome = await fetchAndPersistMessage(ctx, msgId, highestHistoryId)
    if (outcome === 'failed') fetchFailures++
  })
  return fetchFailures
}

async function syncGmailHistoricalBackfill(
  db: RipmailDb,
  ripmailHome: string,
  sourceId: string,
  gmail: GmailClient,
  hist: RipmailHistoricalSince,
  opts: { abort?: AbortSignal },
  result: GmailSyncResult,
  historyId: string | undefined,
): Promise<{ fetchFailures: number; listedCount: number; highestHistoryId: string }> {
  const afterEpoch = historicalSinceToAfterEpochSeconds(hist)
  const lane = 'backfill' as const
  const quotaBucket = createBackfillQuotaBucket()
  let fetchFailures = 0
  let listedCount = 0
  const highestHistoryId = { value: historyId ?? '0' }
  let pageToken: string | undefined
  let pages = 0
  let concurrency = GMAIL_BACKFILL_MESSAGES_GET_CONCURRENCY
  const q = `after:${afterEpoch}`

  const ctx: FetchContext = {
    db,
    ripmailHome,
    sourceId,
    lane,
    abort: opts.abort,
    gmail,
    result,
    quotaBucket,
    getConcurrency: concurrency,
  }

  while (pages < GMAIL_HISTORICAL_LIST_MAX_PAGES) {
    if (opts.abort?.aborted) break

    const resp = await withGmailRetry(
      () =>
        gmail.users.messages.list({
          userId: 'me',
          q,
          maxResults: 500,
          pageToken,
        }),
      { lane: 'backfill' },
    )
    const pageIds = (resp.data.messages ?? []).map((m) => m.id ?? '').filter(Boolean)
    listedCount += pageIds.length
    setBackfillListedTarget(db, listedCount)

    brainLogger.info(
      {
        sourceId,
        lane,
        historicalSince: hist,
        chunkIndex: pages,
        pageListedIds: pageIds.length,
        listedIds: listedCount,
        getConcurrency: concurrency,
      },
      pages === 0 ? 'ripmail:gmail:historical-list' : 'ripmail:gmail:backfill-throttle',
    )

    if (pageIds.length > 0) {
      ctx.getConcurrency = concurrency
      const pageFailures = await fetchMessageIds(ctx, pageIds, concurrency, highestHistoryId)
      fetchFailures += pageFailures
      if (pageFailures > 0 && concurrency > 1) {
        const next = Math.max(1, Math.floor(concurrency / 2))
        brainLogger.info(
          {
            sourceId,
            lane,
            priorConcurrency: concurrency,
            nextConcurrency: next,
            pageFailures,
          },
          'ripmail:gmail:backfill-throttle',
        )
        concurrency = next
      }
    }

    pageToken = resp.data.nextPageToken ?? undefined
    if (!pageToken) break
    pages++
    if (BACKFILL_INTER_PAGE_PAUSE_MS > 0) {
      await interPagePause(BACKFILL_INTER_PAGE_PAUSE_MS)
    }
  }

  return { fetchFailures, listedCount, highestHistoryId: highestHistoryId.value }
}

function backfillMayComplete(listedCount: number, fetchFailures: number): boolean {
  if (listedCount === 0) return true
  const failureRate = fetchFailures / listedCount
  return failureRate <= BACKFILL_COMPLETE_MAX_FAILURE_RATE
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

    const hist = opts?.historicalSince
    const lane: 'refresh' | 'backfill' = hist && isHistoricalSince(hist) ? 'backfill' : 'refresh'

    let fetchFailures = 0
    let listedCount = 0
    let highestHistoryId = historyId ?? '0'

    if (hist && isHistoricalSince(hist)) {
      const backfill = await syncGmailHistoricalBackfill(
        db,
        ripmailHome,
        sourceId,
        gmail,
        hist,
        { abort: opts?.abort },
        result,
        historyId,
      )
      fetchFailures = backfill.fetchFailures
      listedCount = backfill.listedCount
      highestHistoryId = backfill.highestHistoryId
      result.listedCount = listedCount
    } else {
      let messageIds: string[]
      if (historyId) {
        try {
          const historyResp = await withGmailRetry(
            () =>
              gmail.users.history.list({
                userId: 'me',
                startHistoryId: historyId,
                historyTypes: ['messageAdded'],
              }),
            { lane: 'refresh' },
          )
          const added = historyResp.data.history?.flatMap((h) => h.messagesAdded ?? []) ?? []
          messageIds = added.map((m) => m.message?.id ?? '').filter(Boolean)
        } catch {
          messageIds = await listBootstrapMessageIdsWithoutHistory(gmail, opts?.abort)
        }
      } else {
        messageIds = await listBootstrapMessageIdsWithoutHistory(gmail, opts?.abort)
        brainLogger.info(
          { sourceId, lane, phase: 'list', listedIds: messageIds.length },
          'ripmail:gmail:list-phase',
        )
      }

      listedCount = messageIds.length
      result.listedCount = listedCount

      const ctx: FetchContext = {
        db,
        ripmailHome,
        sourceId,
        lane: 'refresh',
        abort: opts?.abort,
        gmail,
        result,
        getConcurrency: GMAIL_MESSAGES_GET_CONCURRENCY,
      }
      const hid = { value: highestHistoryId }
      fetchFailures = 0
      await runWithConcurrencyPool(messageIds, GMAIL_MESSAGES_GET_CONCURRENCY, async (msgId) => {
        const outcome = await fetchAndPersistMessage(ctx, msgId, hid)
        if (outcome === 'failed') fetchFailures++
      })
      highestHistoryId = hid.value
    }

    result.fetchFailures = fetchFailures
    if (listedCount > 0 && fetchFailures === listedCount) {
      result.error = 'All Gmail message fetches failed for this sync run'
    }

    if (!result.error) {
      const finalHistory = await gmail.users.getProfile({ userId: 'me' })
      const newHistoryId = finalHistory.data.historyId ?? highestHistoryId
      updateSyncState(db, sourceId, 'INBOX', 0, 0, String(newHistoryId))
      updateSourceLastSynced(db, sourceId)
    }

    if ((hist === '1y' || hist === '2y') && !result.error && backfillMayComplete(listedCount, fetchFailures)) {
      markFirstBackfillCompleted(db, sourceId)
    }
  } catch (e) {
    result.error = String(e)
    brainLogger.error({ sourceId, err: String(e) }, 'ripmail:gmail:sync-error')
  }

  return result
}
