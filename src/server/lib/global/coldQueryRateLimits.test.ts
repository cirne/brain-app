import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { assertColdQueryRateAllowed, recordColdQuerySent, COLD_QUERY_RATE_LIMIT_MS } from '@server/lib/global/coldQueryRateLimits.js'

describe('coldQueryRateLimits', () => {
  let dbPath: string
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cold-rl-'))
    dbPath = join(dir, 'brain-global.sqlite')
    process.env.BRAIN_GLOBAL_SQLITE_PATH = dbPath
    closeBrainGlobalDbForTests()
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    await rm(join(dbPath, '..'), { recursive: true, force: true })
  })

  it('allows first cold query then blocks within window', () => {
    expect(assertColdQueryRateAllowed({ senderHandle: '@A', receiverHandle: '@B', nowMs: 1_000_000 })).toEqual({
      ok: true,
    })
    recordColdQuerySent({ senderHandle: '@A', receiverHandle: '@B', nowMs: 1_000_000 })
    const again = assertColdQueryRateAllowed({ senderHandle: '@A', receiverHandle: '@B', nowMs: 1_000_000 + 1000 })
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.retryAfterMs).toBeGreaterThan(0)
      expect(again.retryAfterMs).toBeLessThanOrEqual(COLD_QUERY_RATE_LIMIT_MS)
    }
    const after = assertColdQueryRateAllowed({
      senderHandle: '@A',
      receiverHandle: '@B',
      nowMs: 1_000_000 + COLD_QUERY_RATE_LIMIT_MS + 1,
    })
    expect(after).toEqual({ ok: true })
  })
})
