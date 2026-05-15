/**
 * BUG-057: Hub mail status must expose IMAP/Gmail-derived fields (e.g. lastUid) — not omit them when
 * assembling from SQLite-backed {@link ripmailStatusParsed}.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { openRipmailDb, closeRipmailDb } from '@server/ripmail/db.js'
import { updateSyncState } from '@server/ripmail/sync/persist.js'

const ripmailCtx = vi.hoisted(() => ({ home: '' as string }))
vi.mock('@server/lib/platform/brainHome.js', () => ({
  ripmailHomeForBrain: () => ripmailCtx.home,
}))

import { getHubSourceMailStatus } from './hubRipmailSourceStatus.js'

describe('BUG-057 getHubSourceMailStatus IMAP mailbox lastUid', () => {
  beforeEach(async () => {
    ripmailCtx.home = await mkdtemp(join(tmpdir(), 'hub-mail-imap-'))
    mkdirSync(join(ripmailCtx.home, 'imap_src'), { recursive: true })
    writeFileSync(
      join(ripmailCtx.home, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'imap_src',
            kind: 'imap',
            email: 'x@example.com',
            imap: { host: 'imap.example.com', port: 993, user: 'x@example.com' },
          },
        ],
      }),
    )
    const db = openRipmailDb(ripmailCtx.home)
    updateSyncState(db, 'imap_src', 'INBOX', 1, 8842, undefined)
    closeRipmailDb(ripmailCtx.home)
  })

  afterEach(() => {
    closeRipmailDb(ripmailCtx.home)
    try {
      rmSync(ripmailCtx.home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('exposes mailbox.lastUid from sync_state for the inspected source', async () => {
    const r = await getHubSourceMailStatus('imap_src')
    expect(r.ok).toBe(true)
    if (r.ok) {
      /** Today: live synthesis never forwards last_uid into mailboxes[]. */
      expect(r.mailbox?.lastUid).toBe(8842)
    }
  })
})
