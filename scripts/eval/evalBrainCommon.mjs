/**
 * Shared eval home layout: `data-eval/brain` + synthetic ripmail IMAP fixture + rebuild-index.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  for (const d of [join(brain, 'wiki'), join(brain, 'chats'), join(brain, 'cache'), join(brain, 'var')]) {
    mkdirSync(d, { recursive: true })
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

/**
 * @param {string} ripmailBin
 * @param {{ ripHome: string, brain: string }} paths
 */
export function runRebuildIndex(ripmailBin, { ripHome, brain }) {
  const r = spawnSync(ripmailBin, ['rebuild-index'], {
    env: { ...process.env, RIPMAIL_HOME: ripHome, BRAIN_HOME: brain },
    stdio: 'inherit',
  })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}
