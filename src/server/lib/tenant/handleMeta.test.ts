import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  USER_ID_PREFIX,
  USER_ID_RANDOM_LEN,
  generateUserId,
  isValidUserId,
  readHandleMeta,
  writeHandleMeta,
  isHandleConfirmedForTenant,
  HANDLE_META_FILENAME,
} from './handleMeta.js'

describe('handleMeta', () => {
  it('generateUserId uses usr_ prefix and fixed random length', () => {
    const id = generateUserId()
    expect(id.startsWith(USER_ID_PREFIX)).toBe(true)
    expect(id.length).toBe(USER_ID_PREFIX.length + USER_ID_RANDOM_LEN)
    expect(isValidUserId(id)).toBe(true)
  })

  it('generateUserId produces distinct values (probabilistic)', () => {
    const a = generateUserId()
    const b = generateUserId()
    expect(a).not.toBe(b)
  })

  it('isValidUserId rejects bad strings', () => {
    expect(isValidUserId('')).toBe(false)
    expect(isValidUserId('usr_short')).toBe(false)
    expect(isValidUserId(`usr_${'a'.repeat(USER_ID_RANDOM_LEN)}b`)).toBe(false)
    expect(isValidUserId(`usr_${'A'.repeat(USER_ID_RANDOM_LEN)}`)).toBe(false)
  })

  it('round-trips handle-meta.json', async () => {
    const dir = join(tmpdir(), `hm-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const doc = {
        userId: generateUserId(),
        handle: 'alice-test',
        confirmedAt: null as string | null,
      }
      await writeHandleMeta(dir, doc)
      const raw = readFileSync(join(dir, HANDLE_META_FILENAME), 'utf-8')
      expect(JSON.parse(raw).confirmedAt).toBeNull()
      const read = await readHandleMeta(dir)
      expect(read?.userId).toBe(doc.userId)
      expect(read?.handle).toBe('alice-test')
      expect(read?.confirmedAt).toBeNull()
      expect(await isHandleConfirmedForTenant(dir)).toBe(false)
      await writeHandleMeta(dir, {
        ...doc,
        confirmedAt: new Date().toISOString(),
      })
      expect(await isHandleConfirmedForTenant(dir)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
