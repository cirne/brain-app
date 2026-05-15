import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const syncImapSource = vi.hoisted(() => vi.fn())

vi.mock('./imap.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./imap.js')>()
  return { ...actual, syncImapSource }
})

import { closeRipmailDb } from '../db.js'
import { refresh } from './index.js'

describe('refresh skips Enron eval fixture IMAP', () => {
  let home: string

  beforeEach(async () => {
    syncImapSource.mockClear()
    home = await mkdtemp(join(tmpdir(), 'rip-enron-fixture-'))
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'kean_eval_enron_fixture',
            kind: 'imap',
            email: 'steven.kean@enron.com',
            imap: { host: 'fixture.invalid', port: 993, user: 'fixture' },
          },
        ],
      }),
      'utf8',
    )
  })

  afterEach(() => {
    closeRipmailDb(home)
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('does not invoke IMAP sync for corpus-only mailbox ids', async () => {
    const result = await refresh(home)
    expect(syncImapSource).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      messagesAdded: 0,
      messagesUpdated: 0,
      sources: [
        expect.objectContaining({
          sourceId: 'kean_eval_enron_fixture',
          kind: 'imap',
          ok: true,
          messagesAdded: 0,
          messagesUpdated: 0,
        }),
      ],
    })
  })
})
