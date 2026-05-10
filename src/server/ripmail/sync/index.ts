/**
 * refresh() — IMAP sync + Gmail history.list path.
 * Orchestrates sync across all configured IMAP and Google OAuth sources.
 */

import { openRipmailDb } from '../db.js'
import { loadRipmailConfig, getImapSources, loadImapPassword, loadGoogleOAuthTokens } from './config.js'
import { syncImapSource } from './imap.js'
import { syncGmailSource } from './gmail.js'
import type { RefreshOptions, RefreshResult } from '../types.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

/**
 * Trigger an incremental sync for the given source (or all sources).
 * Reads ripmail config.json to discover IMAP / Gmail sources.
 */
export async function refresh(ripmailHome: string, opts?: RefreshOptions): Promise<RefreshResult> {
  const db = openRipmailDb(ripmailHome)
  const config = loadRipmailConfig(ripmailHome)
  const imapSources = getImapSources(config)

  const filteredSources = opts?.sourceId
    ? imapSources.filter((s) => s.id === opts.sourceId || s.email === opts.sourceId)
    : imapSources

  if (filteredSources.length === 0) {
    brainLogger.info({ ripmailHome, sourceId: opts?.sourceId }, 'ripmail:refresh:no-sources')
    return { ok: true, messagesAdded: 0, messagesUpdated: 0, sourceId: opts?.sourceId }
  }

  let totalAdded = 0
  let totalUpdated = 0

  for (const source of filteredSources) {
    try {
      const isGmailOAuth = source.imapAuth === 'googleOAuth'
      if (isGmailOAuth) {
        const oauthTokens = loadGoogleOAuthTokens(ripmailHome, source.id)
        if (oauthTokens) {
          const result = await syncGmailSource(
            db,
            ripmailHome,
            source.id,
            source.email ?? '',
            oauthTokens,
          )
          totalAdded += result.messagesAdded
          totalUpdated += result.messagesUpdated
          if (result.error) {
            brainLogger.warn({ sourceId: source.id, err: result.error }, 'ripmail:refresh:gmail-error')
          }
          continue
        }
      }

      // Standard IMAP
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

  return {
    ok: true,
    messagesAdded: totalAdded,
    messagesUpdated: totalUpdated,
    sourceId: opts?.sourceId,
  }
}
