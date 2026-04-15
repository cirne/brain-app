import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { wikiDir, repoDir } from './wikiDir.js'
import { redactGitRemote } from './redactGitRemote.js'
import { areImessageToolsEnabled, initImessageToolsAvailability } from './imessageDb.js'
import { parseRipmailStatusJson } from './ripmailStatusParse.js'

const execAsync = promisify(exec)

const log = (line: string) => console.log(`[brain-app] ${line}`)

/** One-shot logs for container / production debugging (paths, git, ripmail index). */
export async function logStartupDiagnostics(): Promise<void> {
  initImessageToolsAvailability()
  log(`NODE_ENV=${process.env.NODE_ENV ?? 'undefined'} PORT=${process.env.PORT ?? '3000'}`)
  const repo = repoDir()
  const wiki = wikiDir()
  log(`WIKI_DIR=${repo}`)
  log(`wiki content dir=${wiki}${wiki === repo ? ' (repo root)' : ''}`)

  try {
    const { stdout: head } = await execAsync(`git -C ${JSON.stringify(repo)} rev-parse --short HEAD`)
    log(`git HEAD=${head.trim()}`)
  } catch {
    log('git: not a repo or no commits')
  }

  try {
    const { stdout: origin } = await execAsync(`git -C ${JSON.stringify(repo)} remote get-url origin`)
    log(`git origin=${redactGitRemote(origin.trim())}`)
  } catch {
    log('git: no origin')
  }

  const ripHome = process.env.RIPMAIL_HOME
  log(`RIPMAIL_HOME=${ripHome ?? '(unset → ~/.ripmail)'}`)
  log(`RIPMAIL_BIN=${process.env.RIPMAIL_BIN ?? 'ripmail'}`)

  const rm = process.env.RIPMAIL_BIN ?? 'ripmail'
  try {
    const { stdout } = await execAsync(`${rm} --version`, { timeout: 5000 })
    log(`ripmail: ${stdout.trim().split('\n')[0]}`)
  } catch (e) {
    log(`ripmail --version failed: ${String(e)}`)
  }

  try {
    const { stdout } = await execAsync(`${rm} status --json`, { timeout: 8000 })
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

  if (areImessageToolsEnabled()) {
    log('iMessage: chat.db readable (list_imessage_recent / get_imessage_thread enabled)')
  } else {
    log(
      'iMessage: database not readable — iMessage tools disabled (macOS: grant Full Disk Access to Node/your terminal, or set IMESSAGE_DB_PATH to a readable chat.db copy)',
    )
  }

  log('startup diagnostics complete.')
}
