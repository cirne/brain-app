/**
 * refresh() — IMAP sync + Gmail history.list path.
 * Orchestrates sync across all configured IMAP and Google OAuth sources.
 */

import pLimit from 'p-limit'
import { prepareRipmailDb, type RipmailDb } from '../db.js'
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
import type { RipmailConfig, SourceConfig } from './config.js'
import { syncImapSource } from './imap.js'
import { syncGmailSource } from './gmail.js'
import { syncGoogleCalendarSource } from './googleCalendar.js'
import { getGoogleDriveSources, syncGoogleDriveSource } from './googleDriveSync.js'
import type { RefreshOptions, RefreshResult, RefreshSourceResult } from '../types.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { clearSyncSummaryRunning, setSyncSummaryRunning, updateSourceLastSynced } from './persist.js'
import { ensureSourceRowsFromConfig } from '../sources.js'
import { isEnronEvalFixtureRipmailSourceId } from '@server/lib/auth/enronDemo.js'

/** Global cap for independent source refreshes; per-source syncs keep their own inner limits. */
export const RIPMAIL_REFRESH_SOURCE_CONCURRENCY = 10

type RefreshSourceTask = {
  sourceId: string
  kind: string
  errorLogMessage: string
  run: () => Promise<Omit<RefreshSourceResult, 'sourceId' | 'kind' | 'durationMs'>>
}

function selectedBySourceId(source: SourceConfig, sourceId: string | undefined): boolean {
  return !sourceId || source.id === sourceId || source.email === sourceId
}

function buildRefreshTasks(params: {
  db: RipmailDb
  ripmailHome: string
  config: RipmailConfig
  opts?: RefreshOptions
}): RefreshSourceTask[] {
  const { db, ripmailHome, config, opts } = params
  const imapSources = getImapSources(config).filter((source) => selectedBySourceId(source, opts?.sourceId))
  const calendarSources = getGoogleCalendarSources(config).filter((source) => selectedBySourceId(source, opts?.sourceId))
  const driveSources = getGoogleDriveSources(config.sources).filter((source) => selectedBySourceId(source, opts?.sourceId))

  return [
    ...imapSources.map((source): RefreshSourceTask => ({
      sourceId: source.id,
      kind: source.kind ?? 'imap',
      errorLogMessage: 'ripmail:refresh:source-error',
      run: async () => {
        if (isEnronEvalFixtureRipmailSourceId(source.id)) {
          return { ok: true, messagesAdded: 0, messagesUpdated: 0 }
        }
        const isGmailOAuth = source.imapAuth === 'googleOAuth'
        if (isGmailOAuth) {
          const oauthTokens = loadGoogleOAuthTokens(ripmailHome, source.id)
          if (!oauthTokens) {
            const error = 'No Google OAuth token file available for Gmail sync'
            brainLogger.warn({ sourceId: source.id }, 'ripmail:refresh:gmail-no-oauth-file')
            return { ok: false, messagesAdded: 0, messagesUpdated: 0, error }
          }
          const result = await syncGmailSource(
            db,
            ripmailHome,
            source.id,
            source.email ?? '',
            oauthTokens,
            { historicalSince: opts?.historicalSince },
          )
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
          return {
            ok: !result.error,
            messagesAdded: result.messagesAdded,
            messagesUpdated: result.messagesUpdated,
            error: result.error,
          }
        }

        const password = loadImapPassword(ripmailHome, source.id)
        const result = await syncImapSource(db, ripmailHome, source, password, null, {
          excludeLabels: config.sync?.excludeLabels ?? ['Trash', 'Spam'],
          historicalSince: opts?.historicalSince,
        })
        if (result.error) {
          brainLogger.warn({ sourceId: source.id, err: result.error }, 'ripmail:refresh:imap-error')
        }
        return {
          ok: !result.error,
          messagesAdded: result.messagesAdded,
          messagesUpdated: result.messagesUpdated,
          error: result.error,
        }
      },
    })),
    ...calendarSources.map((source): RefreshSourceTask => ({
      sourceId: source.id,
      kind: source.kind,
      errorLogMessage: 'ripmail:gcal:refresh-source-error',
      run: async () => {
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
        return {
          ok: !result.error,
          eventsUpserted: result.eventsUpserted,
          eventsDeleted: result.eventsDeleted,
          error: result.error,
        }
      },
    })),
    ...driveSources.map((source): RefreshSourceTask => ({
      sourceId: source.id,
      kind: 'googleDrive',
      errorLogMessage: 'ripmail:refresh:drive-error',
      run: async () => {
        const tokenSid = googleOAuthTokenSourceId(source)
        const oauthTokens = loadGoogleOAuthTokens(ripmailHome, tokenSid)
        if (!oauthTokens) {
          const error = 'No Google OAuth token file available for Drive sync'
          brainLogger.warn({ sourceId: source.id, tokenSid }, 'ripmail:refresh:drive-no-oauth-file')
          return { ok: false, messagesAdded: 0, messagesUpdated: 0, error }
        }
        const result = await syncGoogleDriveSource(db, ripmailHome, source, {
          onProgress: opts?.onDriveProgress,
          forceBootstrap: opts?.forceDriveBootstrap,
        })
        if (result.error) {
          brainLogger.warn({ sourceId: source.id, err: result.error }, 'ripmail:refresh:drive-error')
          if (errorMessageIndicatesInvalidGoogleGrant(result.error)) {
            const cleared = removeGoogleOAuthTokenFile(ripmailHome, tokenSid)
            brainLogger.warn(
              { sourceId: source.id, tokenSid, removedOAuthFile: cleared },
              'ripmail:refresh:drive-invalid-grant-cleared',
            )
          }
          return { ok: false, messagesAdded: 0, messagesUpdated: 0, error: result.error }
        }
        updateSourceLastSynced(db, source.id)
        db.prepare(
          `UPDATE sources SET doc_count = (SELECT COUNT(*) FROM document_index WHERE source_id = ? AND kind = 'googleDrive') WHERE id = ?`,
        ).run(source.id, source.id)
        return {
          ok: true,
          messagesAdded: result.added,
          messagesUpdated: result.updated,
        }
      },
    })),
  ]
}

async function runRefreshTask(task: RefreshSourceTask): Promise<RefreshSourceResult> {
  const startedAt = Date.now()
  try {
    const result = await task.run()
    return {
      sourceId: task.sourceId,
      kind: task.kind,
      durationMs: Date.now() - startedAt,
      ...result,
    }
  } catch (e) {
    const error = String(e)
    brainLogger.error({ sourceId: task.sourceId, err: error }, task.errorLogMessage)
    return {
      sourceId: task.sourceId,
      kind: task.kind,
      ok: false,
      durationMs: Date.now() - startedAt,
      error,
    }
  }
}

/**
 * Trigger an incremental sync for the given source (or all sources).
 * Reads ripmail config.json to discover IMAP / Gmail sources.
 */
export async function refresh(ripmailHome: string, opts?: RefreshOptions): Promise<RefreshResult> {
  const db = await prepareRipmailDb(ripmailHome)
  const config = loadRipmailConfig(ripmailHome)
  ensureSourceRowsFromConfig(db, config)
  const tasks = buildRefreshTasks({ db, ripmailHome, config, opts })

  if (tasks.length === 0) {
    brainLogger.info({ ripmailHome, sourceId: opts?.sourceId }, 'ripmail:refresh:no-sources')
    return { ok: true, messagesAdded: 0, messagesUpdated: 0, sourceId: opts?.sourceId, sources: [] }
  }

  const lane = opts?.historicalSince ? 'backfill' : 'refresh'
  setSyncSummaryRunning(db, lane)

  try {
    const limit = pLimit(RIPMAIL_REFRESH_SOURCE_CONCURRENCY)
    const sources = await Promise.all(tasks.map((task) => limit(() => runRefreshTask(task))))
    const totalAdded = sources.reduce((sum, source) => sum + (source.messagesAdded ?? 0), 0)
    const totalUpdated = sources.reduce((sum, source) => sum + (source.messagesUpdated ?? 0), 0)
    const ok = sources.every((source) => source.ok)

    brainLogger.info(
      {
        ripmailHome,
        sourceId: opts?.sourceId,
        lane,
        sourceCount: sources.length,
        concurrency: RIPMAIL_REFRESH_SOURCE_CONCURRENCY,
        sources: sources.map((source) => ({
          sourceId: source.sourceId,
          kind: source.kind,
          ok: source.ok,
          durationMs: source.durationMs,
          messagesAdded: source.messagesAdded,
          messagesUpdated: source.messagesUpdated,
          eventsUpserted: source.eventsUpserted,
          eventsDeleted: source.eventsDeleted,
          error: source.error,
        })),
      },
      'ripmail:refresh:completed',
    )

    return {
      ok,
      messagesAdded: totalAdded,
      messagesUpdated: totalUpdated,
      sourceId: opts?.sourceId,
      sources,
    }
  } finally {
    clearSyncSummaryRunning(db)
  }
}
