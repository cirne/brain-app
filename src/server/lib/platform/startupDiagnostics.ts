import { BRAIN_DEFAULT_HTTP_PORT, GOOGLE_OAUTH_CALLBACK_PATH } from './brainHttpPort.js'
import { initLocalMessageToolsAvailability } from '@server/lib/apple/imessageDb.js'
import { logFdaProbeForStartup } from '@server/lib/apple/fdaProbe.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { logger } from '@server/lib/observability/logger.js'

/** One-shot logs for container / production debugging (paths, ripmail index). */
export async function logStartupDiagnostics(listenPort?: number): Promise<void> {
  initLocalMessageToolsAvailability()
  logger.info(
    `NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} HTTP listen port=${listenPort ?? parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)}`,
  )
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    !process.env.PUBLIC_WEB_ORIGIN?.trim()
  ) {
    logger.info(
      `Gmail OAuth: PUBLIC_WEB_ORIGIN unset — redirect URI will be inferred from X-Forwarded-Proto/Host per request (${GOOGLE_OAUTH_CALLBACK_PATH}); set PUBLIC_WEB_ORIGIN to your canonical https:// origin for stability`,
    )
  }
  logFdaProbeForStartup((line) => logger.info(line))
  logger.info(`BRAIN_DATA_ROOT=${process.env.BRAIN_DATA_ROOT}`)
  logger.info(
    'multi-tenant: BRAIN_HOME is per-request; periodic sync / your-wiki loop disabled at process level',
  )
  logger.info(
    'ripmail home (Brain)=per-tenant `$BRAIN_DATA_ROOT/<tenantUserId>/<layout ripmail>/` (resolved per request; not logged globally)',
  )
  if (process.env.RIPMAIL_HOME?.trim()) {
    logger.warn(
      'RIPMAIL_HOME is set in the environment but Brain ignores it in multi-tenant mode — unset RIPMAIL_HOME to avoid confusion.',
    )
  }
  logger.info(
    'RIPMAIL_HOME env has no effect on Brain mail paths in multi-tenant mode (ripmail home is derived per tenant).',
  )
  if (process.env.IMESSAGE_DB_PATH?.trim()) {
    logger.info(
      'warning: IMESSAGE_DB_PATH is set while BRAIN_DATA_ROOT is set — iMessage is host-level, not tenant-scoped',
    )
  }
  const rm = ripmailBin()
  logger.info(`RIPMAIL_BIN=${rm}`)
  logger.info('ripmail --version / status: skipped at startup in multi-tenant mode (no global RIPMAIL_HOME)')

  logger.info('Local messages / iMessage tools: disabled in hosted multi-tenant mode.')

  logger.info('startup diagnostics complete.')
}
