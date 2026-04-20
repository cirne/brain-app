import { BRAIN_DEFAULT_HTTP_PORT } from './brainHttpPort.js'
import { brainHome, brainWikiParentRoot } from './brainHome.js'
import { wikiDir } from './wikiDir.js'
import { areLocalMessageToolsEnabled, initLocalMessageToolsAvailability } from './imessageDb.js'
import { logFdaProbeForStartup } from './fdaProbe.js'
import { parseRipmailStatusJson } from './ripmailStatusParse.js'
import { execRipmailAsync } from './ripmailExec.js'
import { ripmailBin } from './ripmailBin.js'

const log = (line: string) => console.log(`[brain-app] ${line}`)

/** One-shot logs for container / production debugging (paths, ripmail index). */
export async function logStartupDiagnostics(listenPort?: number): Promise<void> {
  initLocalMessageToolsAvailability()
  const bundledNative = process.env.BRAIN_BUNDLED_NATIVE === '1'
  if (bundledNative) {
    log(
      `NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} HTTPS listen port=${listenPort ?? '?'} (bundled native; TLS, port from dynamic bind, not PORT env)`,
    )
  } else {
    log(
      `NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} HTTP listen port=${listenPort ?? parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)}`,
    )
  }
  logFdaProbeForStartup(log)
  const home = brainHome()
  const wiki = wikiDir()
  const wikiParent = brainWikiParentRoot()
  log(`BRAIN_HOME=${home}`)
  log(`BRAIN_WIKI_ROOT=${wikiParent}`)
  log(`wiki content dir=${wiki}`)

  const ripHome = process.env.RIPMAIL_HOME
  log(`RIPMAIL_HOME=${ripHome ?? '(derived from BRAIN_HOME/ripmail)'}`)
  const rm = ripmailBin()
  log(`RIPMAIL_BIN=${rm}`)
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

  if (areLocalMessageToolsEnabled()) {
    log('Local messages: chat.db readable (list_recent_messages / get_message_thread enabled)')
  } else {
    log(
      'Local messages: database not readable — SMS/text tools disabled (macOS: grant Full Disk Access to Node/your terminal, or set IMESSAGE_DB_PATH to a readable chat.db copy)',
    )
  }

  log('startup diagnostics complete.')
}
