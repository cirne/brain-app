import { BRAIN_DEFAULT_HTTP_PORT, GOOGLE_OAUTH_CALLBACK_PATH } from './brainHttpPort.js'
import { initLocalMessageToolsAvailability } from '@server/lib/apple/imessageDb.js'
import { logFdaProbeForStartup } from '@server/lib/apple/fdaProbe.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

/** One-shot logs for container / production debugging (paths, ripmail index). */
export async function logStartupDiagnostics(listenPort?: number): Promise<void> {
  initLocalMessageToolsAvailability()
  brainLogger.info(
    `NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} HTTP listen port=${listenPort ?? parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)}`,
  )
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    !process.env.PUBLIC_WEB_ORIGIN?.trim()
  ) {
    brainLogger.info(
      `Gmail OAuth: PUBLIC_WEB_ORIGIN unset — redirect URI will be inferred from X-Forwarded-Proto/Host per request (${GOOGLE_OAUTH_CALLBACK_PATH}); set PUBLIC_WEB_ORIGIN to your canonical https:// origin for stability`,
    )
  }
  logFdaProbeForStartup((line) => brainLogger.info(line))
  brainLogger.info(`BRAIN_DATA_ROOT=${process.env.BRAIN_DATA_ROOT}`)
  brainLogger.info(
    'multi-tenant: BRAIN_HOME is per-request; periodic sync / your-wiki loop disabled at process level',
  )
  brainLogger.info(
    'ripmail home (Brain)=per-tenant `$BRAIN_DATA_ROOT/<tenantUserId>/<layout ripmail>/` (resolved per request; not logged globally)',
  )
  if (process.env.RIPMAIL_HOME?.trim()) {
    brainLogger.warn(
      'RIPMAIL_HOME is set in the environment but Brain ignores it in multi-tenant mode — unset RIPMAIL_HOME to avoid confusion.',
    )
  }
  brainLogger.info(
    'RIPMAIL_HOME env has no effect on Brain mail paths in multi-tenant mode (ripmail home is derived per tenant).',
  )
  if (process.env.IMESSAGE_DB_PATH?.trim()) {
    brainLogger.info(
      'warning: IMESSAGE_DB_PATH is set while BRAIN_DATA_ROOT is set — iMessage is host-level, not tenant-scoped',
    )
  }
  brainLogger.info('ripmail: TypeScript in-process module (archived OPP-103); no ripmail CLI subprocess in server')

  brainLogger.info('Local messages / iMessage tools: disabled in hosted multi-tenant mode.')

  brainLogger.info('startup diagnostics complete.')
}
