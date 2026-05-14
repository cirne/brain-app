// Dev-only: run in-process Google Drive refresh (OAuth + ripmail config.json on disk).
// Not part of CI — use to inspect `[drive] …` logs and refresh JSON for a local tenant.
//
// Repo root (nvm + .env as for normal dev):
//
//   npm run drive:e2e -- <workspace-handle>
//   DRIVE_E2E_WORKSPACE=<handle> npm run drive:e2e
//   BRAIN_WORKSPACE_HANDLE=<handle> npm run drive:e2e   # if already set in your shell
//
// Ripmail home (skips tenant-dir when set):
//
//   DRIVE_E2E_RIPMAIL_HOME=/abs/path/to/ripmail npm run drive:e2e
//
// Other env:
//   DRIVE_E2E_DRY_RUN=1 — load config only, no refresh()
//   DRIVE_E2E_FORCE_DRIVE_BOOTSTRAP=1 — wipe local Drive index + meta + cursor, then refresh
//
// Load .env so GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are set (tokens on disk
// often omit client id/secret).

import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { brainLayoutRipmailDir } from '../src/server/lib/platform/brainLayout.js'
import { loadRipmailConfig } from '../src/server/ripmail/sync/config.js'
import { refresh } from '../src/server/ripmail/sync/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function resolveWorkspaceHandle(): string {
  const fromArgv = process.argv[2]?.trim()
  if (fromArgv) return fromArgv
  return (
    process.env.DRIVE_E2E_WORKSPACE?.trim() ||
    process.env.BRAIN_WORKSPACE_HANDLE?.trim() ||
    ''
  )
}

function printRipmailHomeHelp(): void {
  console.error(
    [
      'drive:e2e: need a ripmail home, or a workspace handle to resolve it.',
      '',
      '  npm run drive:e2e -- <workspace-handle>',
      '  DRIVE_E2E_WORKSPACE=<handle> npm run drive:e2e',
      '  BRAIN_WORKSPACE_HANDLE=<handle> npm run drive:e2e',
      '  DRIVE_E2E_RIPMAIL_HOME=/abs/path/to/ripmail npm run drive:e2e',
      '',
      'Example: npm run drive:e2e -- cirne',
    ].join('\n'),
  )
}

function resolveRipmailHome(): string {
  const fromEnv = process.env.DRIVE_E2E_RIPMAIL_HOME?.trim()
  if (fromEnv) return resolve(fromEnv)

  const handle = resolveWorkspaceHandle()
  if (!handle) {
    printRipmailHomeHelp()
    process.exit(1)
  }

  const tenantDirScript = join(repoRoot, 'scripts', 'tenant-dir.mjs')
  let tenantHome: string
  try {
    tenantHome = execFileSync(process.execPath, [tenantDirScript, handle], {
      encoding: 'utf8',
      cwd: repoRoot,
    }).trim()
  } catch {
    console.error(
      `Could not resolve tenant for handle ${JSON.stringify(handle)} via scripts/tenant-dir.mjs.`,
    )
    console.error('Try: node scripts/tenant-dir.mjs', handle)
    process.exit(1)
  }
  if (!tenantHome) {
    console.error('scripts/tenant-dir.mjs returned empty output')
    process.exit(1)
  }
  return brainLayoutRipmailDir(tenantHome)
}

async function main(): Promise<void> {
  process.once('SIGINT', () => {
    console.error(
      '\n[drive:e2e] SIGINT — exiting. Node does not print the blocked async stack for Ctrl+C.',
    )
    console.error(
      '[drive:e2e] If progress stopped mid-sync, the next Drive HTTP call may be blocked (timeouts surface after ~120s).',
    )
    console.error('[drive:e2e] Tip: run with `NODE_OPTIONS=--trace-warnings` or attach a debugger to see pending work.')
    process.exit(130)
  })

  const ripmailHome = resolveRipmailHome()
  const cfg = loadRipmailConfig(ripmailHome)
  const drive = cfg.sources?.find((s) => s.kind === 'googleDrive')
  if (!drive?.id) {
    console.error(`No googleDrive source in config.json under ${ripmailHome}`)
    process.exit(1)
  }
  const ripmailFromEnv = Boolean(process.env.DRIVE_E2E_RIPMAIL_HOME?.trim())
  const handleNote = ripmailFromEnv ? 'ripmailHome=DRIVE_E2E_RIPMAIL_HOME' : `workspace=${resolveWorkspaceHandle()}`
  console.log(`Drive sync: sourceId=${drive.id} ripmailHome=${ripmailHome} (${handleNote})`)
  if (process.env.DRIVE_E2E_FORCE_DRIVE_BOOTSTRAP === '1') {
    console.log('[drive:e2e] DRIVE_E2E_FORCE_DRIVE_BOOTSTRAP=1 — will wipe local Drive index + meta + cursor, then refresh')
  }
  if (process.env.DRIVE_E2E_DRY_RUN === '1') {
    console.log('[drive:e2e] DRIVE_E2E_DRY_RUN=1 — skipping refresh()')
    process.exit(0)
  }
  const r = await refresh(ripmailHome, {
    sourceId: drive.id,
    onDriveProgress: (msg) => console.log(msg),
    forceDriveBootstrap: process.env.DRIVE_E2E_FORCE_DRIVE_BOOTSTRAP === '1',
  })
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
