/**
 * Shared ripmail fixture helpers (sha256, TypeScript rebuild-index) used by eval ingest scripts.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * @param {string} filePath
 * @returns {string} hex sha256
 */
export function sha256File(filePath) {
  const h = createHash('sha256')
  h.update(readFileSync(filePath))
  return h.digest('hex')
}

/**
 * @param {string} brain
 */
export function ensureEvalBrainDirs(brain) {
  for (const seg of ['wiki', 'chats', 'cache', 'var', 'skills', 'issues']) {
    mkdirSync(join(brain, seg), { recursive: true })
  }
}

/**
 * @param {string} ripHome
 * @param {{ mailboxId: string, accountEmail: string }} m
 */
export function writeRipmailEvalFixture(ripHome, m) {
  mkdirSync(ripHome, { recursive: true })
  const mbId = m.mailboxId
  const config = {
    sources: [
      {
        id: mbId,
        kind: 'imap',
        email: m.accountEmail,
        imap: {
          host: 'imap.gmail.com',
          port: 993,
          user: m.accountEmail,
        },
        imap_auth: 'appPassword',
      },
    ],
    sync: {
      defaultSince: '1y',
      mailbox: '',
      excludeLabels: ['Trash', 'Spam'],
    },
  }
  writeFileSync(join(ripHome, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
  const dotEnv = 'RIPMAIL_IMAP_PASSWORD=eval-fixture-not-for-imap\n'
  writeFileSync(join(ripHome, '.env'), dotEnv, 'utf8')
  mkdirSync(join(ripHome, mbId), { recursive: true })
  writeFileSync(join(ripHome, mbId, '.env'), dotEnv, 'utf8')
}

function resolveTsxCli(repoRoot) {
  const p = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  return existsSync(p) ? p : null
}

/**
 * Run TS maildir → SQLite rebuild (replaces `ripmail rebuild-index`).
 * @param {{ ripHome: string, brain: string, maildirRoot: string }} paths
 */
export function runRebuildIndex({ ripHome, brain, maildirRoot }) {
  const repoRoot = resolve(process.env.BRAIN_SEED_REPO_ROOT?.trim() || process.cwd())
  const compiled = join(repoRoot, 'dist', 'server', 'ripmail', 'rebuildFromMaildirCli.js')
  const tsconfig = join(repoRoot, 'tsconfig.server.json')
  const tsEntry = join(repoRoot, 'src', 'server', 'ripmail', 'rebuildFromMaildirCli.ts')
  const homeAbs = resolve(ripHome)
  const brainAbs = resolve(brain)
  const mdAbs = resolve(maildirRoot)

  let execArgv
  if (existsSync(compiled)) {
    execArgv = [compiled, homeAbs, mdAbs]
  } else {
    const tsxCli = resolveTsxCli(repoRoot)
    if (!tsxCli) {
      console.error('[eval] tsx CLI not found under node_modules; run pnpm install from repo root.')
      process.exit(1)
    }
    execArgv = [tsxCli, '--tsconfig', tsconfig, tsEntry, homeAbs, mdAbs]
  }

  const r = spawnSync(process.execPath, execArgv, {
    env: { ...process.env, RIPMAIL_HOME: homeAbs, BRAIN_HOME: brainAbs },
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}
