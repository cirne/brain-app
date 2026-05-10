import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ripmailRefreshMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, messagesAdded: 0, messagesUpdated: 0 }))

vi.mock('@server/ripmail/sync/index.js', () => ({
  refresh: ripmailRefreshMock,
}))

vi.mock('@server/lib/platform/googleOAuth.js', () => ({
  ensureGoogleOAuthImapSiblingSources: vi.fn().mockResolvedValue(undefined),
}))

import { refreshMailAndWait } from './syncAll.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'refresh-mail-wait-'))
  process.env.BRAIN_HOME = brainHome
  ripmailRefreshMock.mockReset()
  ripmailRefreshMock.mockResolvedValue({ ok: true, messagesAdded: 0, messagesUpdated: 0 })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('refreshMailAndWait', () => {
  it('returns ok:false when refresh rejects', async () => {
    ripmailRefreshMock.mockRejectedValueOnce(new Error('sync timed out'))
    const r = await refreshMailAndWait(90_000)
    // TS refresh doesn't distinguish timeout from error — both return ok:false
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('returns ok:true when refresh completes', async () => {
    const r = await refreshMailAndWait(5000)
    expect(r.ok).toBe(true)
    expect(r.timedOut).toBeUndefined()
  })
})
