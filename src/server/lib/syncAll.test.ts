import { writeFile, chmod, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { getSyncIntervalMs, syncCalendarFromEnv, syncInboxRipmail, syncWikiFromDisk } from './syncAll.js'

describe('syncWikiFromDisk', () => {
  it('always succeeds (no git)', async () => {
    const r = await syncWikiFromDisk()
    expect(r).toEqual({ ok: true })
  })
})

describe('getSyncIntervalMs', () => {
  const orig = process.env.SYNC_INTERVAL_SECONDS

  afterEach(() => {
    if (orig === undefined) delete process.env.SYNC_INTERVAL_SECONDS
    else process.env.SYNC_INTERVAL_SECONDS = orig
  })

  it('defaults to 300 seconds as milliseconds', () => {
    delete process.env.SYNC_INTERVAL_SECONDS
    expect(getSyncIntervalMs()).toBe(300_000)
  })

  it('parses a positive integer as seconds', () => {
    process.env.SYNC_INTERVAL_SECONDS = '60'
    expect(getSyncIntervalMs()).toBe(60_000)
  })

  it('falls back on invalid values', () => {
    process.env.SYNC_INTERVAL_SECONDS = 'nope'
    expect(getSyncIntervalMs()).toBe(300_000)
  })

  it('falls back on zero or negative', () => {
    process.env.SYNC_INTERVAL_SECONDS = '0'
    expect(getSyncIntervalMs()).toBe(300_000)
  })
})

describe('syncCalendarFromEnv', () => {
  const origTravel = process.env.CIRNE_TRAVEL_ICS_URL
  const origPersonal = process.env.LEW_PERSONAL_ICS_URL

  afterEach(() => {
    if (origTravel === undefined) delete process.env.CIRNE_TRAVEL_ICS_URL
    else process.env.CIRNE_TRAVEL_ICS_URL = origTravel
    if (origPersonal === undefined) delete process.env.LEW_PERSONAL_ICS_URL
    else process.env.LEW_PERSONAL_ICS_URL = origPersonal
  })

  it('returns ok when no ICS URLs are configured', async () => {
    delete process.env.CIRNE_TRAVEL_ICS_URL
    delete process.env.LEW_PERSONAL_ICS_URL
    const r = await syncCalendarFromEnv()
    expect(r.ok).toBe(true)
  })
})

describe('syncInboxRipmail', () => {
  const origBin = process.env.RIPMAIL_BIN

  afterEach(async () => {
    if (origBin === undefined) delete process.env.RIPMAIL_BIN
    else process.env.RIPMAIL_BIN = origBin
  })

  it('does not block on a slow ripmail child (detached spawn)', async () => {
    const dir = join(tmpdir(), `brain-sync-inbox-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    const fakeRm = join(dir, 'fake-ripmail-slow')
    await writeFile(fakeRm, '#!/bin/sh\nsleep 300\n', 'utf8')
    await chmod(fakeRm, 0o755)
    process.env.RIPMAIL_BIN = fakeRm

    const start = Date.now()
    const r = await syncInboxRipmail()
    const elapsed = Date.now() - start
    expect(r.ok).toBe(true)
    expect(elapsed).toBeLessThan(3000)

    await rm(dir, { recursive: true, force: true })
  })
})
