/**
 * refresh() — IMAP sync + Gmail history.list path.
 * Orchestrates sync across all configured IMAP and Google OAuth sources.
 */

import { prepareRipmailDb } from '../db.js'
import {
  loadRipmailConfig,
  getImapSources,
  getGoogleCalendarSources,
  loadImapPassword,
  loadGoogleOAuthTokens,
  errorMessageIndicatesInvalidGoogleGrant,
  removeGoogleOAuthTokenFile,
  googleOAuthTokenSourceId,
} from './config.js'
import { syncImapSource } from './imap.js'
import { syncGmailSource } from './gmail.js'
import { syncGoogleCalendarSource } from './googleCalendar.js'
import type { RefreshOptions, RefreshResult } from '../types.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { clearSyncSummaryRunning, setSyncSummaryRunning } from './persist.js'
import { ensureSourceRowsFromConfig } from '../sources.js'

/**
 * Trigger an incremental sync for the given source (or all sources).
 * Reads ripmail config.json to discover IMAP / Gmail sources.
 */
export async function refresh(ripmailHome: string, opts?: RefreshOptions): Promise<RefreshResult> {
  const db = await prepareRipmailDb(ripmailHome)
  const config = loadRipmailConfig(ripmailHome)
  ensureSourceRowsFromConfig(db, config)
  const imapSources = getImapSources(config)
  const calendarSources = getGoogleCalendarSources(config)

  const filteredSources = opts?.sourceId
    ? imapSources.filter((s) => s.id === opts.sourceId || s.email === opts.sourceId)
    : imapSources
  const filteredCalendarSources = opts?.sourceId
    ? calendarSources.filter((s) => s.id === opts.sourceId || s.email === opts.sourceId)
    : calendarSources

  if (filteredSources.length === 0 && filteredCalendarSources.length === 0) {
    brainLogger.info({ ripmailHome, sourceId: opts?.sourceId }, 'ripmail:refresh:no-sources')
    return { ok: true, messagesAdded: 0, messagesUpdated: 0, sourceId: opts?.sourceId }
  }

  const lane = opts?.historicalSince ? 'backfill' : 'refresh'
  setSyncSummaryRunning(db, lane)

  let totalAdded = 0
  let totalUpdated = 0

  try {
    for (const source of filteredSources) {
      try {
        const isGmailOAuth = source.imapAuth === 'googleOAuth'
        if (isGmailOAuth) {
          const oauthTokens = loadGoogleOAuthTokens(ripmailHome, source.id)
          if (!oauthTokens) {
            brainLogger.warn({ sourceId: source.id }, 'ripmail:refresh:gmail-no-oauth-file')
            continue
          }
          const result = await syncGmailSource(
            db,
            ripmailHome,
            source.id,
            source.email ?? '',
            oauthTokens,
            { historicalSince: opts?.historicalSince },
          )
          totalAdded += result.messagesAdded
          totalUpdated += result.messagesUpdated
          if (result.error) {
            brainLogger.warn({ sourceId: source.id, err: result.error }, 'ripmail:refresh:gmail-error')
            if (errorMessageIndicatesInvalidGoogleGrant(result.error)) {
              const cleared = removeGoogleOAuthTokenFile(ripmailHome, source.id)
              brainLogger.warn(
                { sourceId: source.id, removedOAuthFile: cleared },
                'ripmail:refresh:gmail-invalid-grant-cleared',
              )
            }
          }
          continue
        }

        const password = loadImapPassword(ripmailHome, source.id)
        const result = await syncImapSource(db, ripmailHome, source, password, null, {
          excludeLabels: config.sync?.excludeLabels ?? ['Trash', 'Spam'],
        })
        totalAdded += result.messagesAdded
        totalUpdated += result.messagesUpdated
        if (result.error) {
          brainLogger.warn({ sourceId: source.id, err: result.error }, 'ripmail:refresh:imap-error')
        }
      } catch (e) {
        brainLogger.error({ sourceId: source.id, err: String(e) }, 'ripmail:refresh:source-error')
      }
    }

    for (const source of filteredCalendarSources) {
      try {
        const result = await syncGoogleCalendarSource(db, ripmailHome, source)
        if (result.error) {
          brainLogger.warn({ sourceId: source.id, err: result.error }, 'ripmail:gcal:refresh-error')
          if (errorMessageIndicatesInvalidGoogleGrant(result.error)) {
            const tokenSourceId = googleOAuthTokenSourceId(source)
            const cleared = removeGoogleOAuthTokenFile(ripmailHome, tokenSourceId)
            brainLogger.warn(
              { sourceId: source.id, tokenSourceId, removedOAuthFile: cleared },
              'ripmail:gcal:invalid-grant-cleared',
            )
          }
        }
      } catch (e) {
        brainLogger.error({ sourceId: source.id, err: String(e) }, 'ripmail:gcal:refresh-source-error')
      }
    }

    return {
      ok: true,
      messagesAdded: totalAdded,
      messagesUpdated: totalUpdated,
      sourceId: opts?.sourceId,
    }
  } finally {
    clearSyncSummaryRunning(db)
  }
}
