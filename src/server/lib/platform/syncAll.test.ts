import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ripmailRefreshMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, messagesAdded: 0, messagesUpdated: 0 }))

vi.mock('@server/ripmail/sync/index.js', () => ({
  refresh: ripmailRefreshMock,
}))

import { ripmailRefreshEnv, syncInboxRipmailOnboarding } from './syncAll.js'
import { ripmailHomeForBrain, ripmailProcessEnv } from './brainHome.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'sync-all-'))
  process.env.BRAIN_HOME = brainHome
  delete process.env.RIPMAIL_HOME
  ripmailRefreshMock.mockClear()
  ripmailRefreshMock.mockResolvedValue({ ok: true, messagesAdded: 0, messagesUpdated: 0 })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('ripmailRefreshEnv', () => {
  it('sets RIPMAIL_HOME to the same path as onboarding / status polls', () => {
    expect(ripmailRefreshEnv().RIPMAIL_HOME).toBe(ripmailHomeForBrain())
  })

  it('delegates to ripmailProcessEnv (single source for ripmail child env)', () => {
    expect(ripmailRefreshEnv()).toEqual(ripmailProcessEnv())
  })
})

describe('syncInboxRipmailOnboarding', () => {
  it('runs Gmail historical onboarding slice (~1y)', async () => {
    const r = await syncInboxRipmailOnboarding(undefined)
    expect(r.ok).toBe(true)
    expect(ripmailRefreshMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ historicalSince: '1y' }),
    )
  })

  it('returns { ok: false, error } when backfill fails', async () => {
    ripmailRefreshMock.mockRejectedValueOnce(new Error('ripmail failed'))
    const r = await syncInboxRipmailOnboarding(undefined)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/ripmail failed/)
  })
})
