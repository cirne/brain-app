import { BRAIN_DEFAULT_HTTP_PORT, GOOGLE_OAUTH_CALLBACK_PATH } from './brainHttpPort.js'
import { brainWikiParentRoot, resolveBrainHomeDiskRoot } from './brainHome.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { isAppleLocalIntegrationEnvironment } from '@server/lib/apple/appleLocalIntegrationEnv.js'
import { areLocalMessageToolsEnabled, initLocalMessageToolsAvailability } from '@server/lib/apple/imessageDb.js'
import { logFdaProbeForStartup } from '@server/lib/apple/fdaProbe.js'
import { parseRipmailStatusJson } from '@server/lib/ripmail/ripmailStatusParse.js'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailExec.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'

const log = (line: string) => console.log(`[brain-app] ${line}`)

/** One-shot logs for container / production debugging (paths, ripmail index). */
export async function logStartupDiagnostics(listenPort?: number): Promise<void> {
  initLocalMessageToolsAvailability()
  const bundledNative = process.env.BRAIN_BUNDLED_NATIVE === '1'
  if (bundledNative) {
    log(
      `NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} HTTP listen port=${listenPort ?? '?'} (bundled native; port from dynamic bind, not PORT env)`,
    )
  } else {
    log(
      `NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} HTTP listen port=${listenPort ?? parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)}`,
    )
  }
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.BRAIN_BUNDLED_NATIVE !== '1' &&
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    !process.env.PUBLIC_WEB_ORIGIN?.trim()
  ) {
    log(
      `Gmail OAuth: PUBLIC_WEB_ORIGIN unset — redirect URI will be inferred from X-Forwarded-Proto/Host per request (${GOOGLE_OAUTH_CALLBACK_PATH}); set PUBLIC_WEB_ORIGIN to your canonical https:// origin for stability`,
    )
  }
  logFdaProbeForStartup(log)
  if (isMultiTenantMode()) {
    log(`BRAIN_DATA_ROOT=${process.env.BRAIN_DATA_ROOT}`)
    log('multi-tenant: BRAIN_HOME is per-request; periodic sync / your-wiki loop disabled at process level')
  } else {
    const home = resolveBrainHomeDiskRoot()
    const wiki = wikiDir()
    const wikiParent = brainWikiParentRoot()
    log(`BRAIN_HOME=${home}`)
    log(`BRAIN_WIKI_ROOT=${wikiParent}`)
    log(`wiki content dir=${wiki}`)
  }

  const ripHome = process.env.RIPMAIL_HOME
  log(
    `RIPMAIL_HOME=${ripHome ?? (isMultiTenantMode() ? '(per-tenant $HOME/ripmail)' : '(derived from BRAIN_HOME/ripmail)')}`,
  )
  if (isMultiTenantMode() && process.env.IMESSAGE_DB_PATH?.trim()) {
    log('warning: IMESSAGE_DB_PATH is set while BRAIN_DATA_ROOT is set — iMessage is host-level, not tenant-scoped')
  }
  const rm = ripmailBin()
  log(`RIPMAIL_BIN=${rm}`)
  if (!isMultiTenantMode()) {
    try {
      const { stdout } = await execRipmailAsync(`${rm} --version`, { timeout: 5000 })
      log(`ripmail: ${stdout.trim().split('\n')[0]}`)
    } catch (e) {
      log(`ripmail --version failed: ${String(e)}`)
    }

    try {
      const { stdout } = await execRipmailAsync(`${rm} status --json`, { timeout: 8000 })
      const parsed = parseRipmailStatusJson(stdout)
      if (parsed) {
        const total = parsed.indexedTotal
        const last = parsed.lastSyncedAt
        log(`ripmail index: messages≈${total ?? '?'} lastSync=${last ?? '?'}`)
      } else {
        log(`ripmail status (truncated): ${stdout.slice(0, 240)}`)
      }
    } catch (e) {
      log(`ripmail status failed — check RIPMAIL_HOME and ripmail config: ${String(e)}`)
    }
  } else {
    log('ripmail --version / status: skipped at startup in multi-tenant mode (no global RIPMAIL_HOME)')
  }

  if (isMultiTenantMode()) {
    log('Local messages: disabled in multi-tenant / hosted mode (no per-tenant chat.db integration).')
  } else if (!isAppleLocalIntegrationEnvironment()) {
    log(
      'Local messages / on-device Apple Mail: not available on this host — iMessage/SMS tools disabled (requires macOS)',
    )
  } else if (areLocalMessageToolsEnabled()) {
    log('Local messages: chat.db readable (list_recent_messages / get_message_thread enabled)')
  } else {
    log(
      'Local messages: database not readable — SMS/text tools disabled (macOS: grant Full Disk Access to Node/your terminal, or set IMESSAGE_DB_PATH to a readable chat.db copy)',
    )
  }

  log('startup diagnostics complete.')
}
