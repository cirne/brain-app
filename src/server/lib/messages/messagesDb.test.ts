import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  getStoredThreadMessages,
  getImessageCursorForDevice,
  searchImessageMessages,
  upsertImessageBatch,
  wipeImessageMessages,
} from './messagesDb.js'

let brainHome: string
let prevBrainHome: string | undefined
let prevDataRoot: string | undefined

beforeEach(async () => {
  prevBrainHome = process.env.BRAIN_HOME
  prevDataRoot = process.env.BRAIN_DATA_ROOT
  delete process.env.BRAIN_DATA_ROOT
  brainHome = await mkdtemp(join(tmpdir(), 'messages-db-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  if (prevBrainHome == null) delete process.env.BRAIN_HOME
  else process.env.BRAIN_HOME = prevBrainHome
  if (prevDataRoot == null) delete process.env.BRAIN_DATA_ROOT
  else process.env.BRAIN_DATA_ROOT = prevDataRoot
  await rm(brainHome, { recursive: true, force: true })
})

describe('messagesDb', () => {
  it('upserts rows and advances cursor per device', () => {
    const result = upsertImessageBatch('mac-1', [
      {
        guid: 'g-1',
        rowid: 10,
        date_ms: Date.parse('2026-04-27T12:00:00.000Z'),
        text: 'hello',
        is_from_me: false,
        handle: '+15550001111',
        chat_identifier: '+15550001111',
      },
      {
        guid: 'g-2',
        rowid: 11,
        date_ms: Date.parse('2026-04-27T12:01:00.000Z'),
        text: 'world',
        is_from_me: true,
        handle: '+15550001111',
        chat_identifier: '+15550001111',
      },
    ])
    expect(result.accepted).toBe(2)
    expect(result.lastRowid).toBe(11)
    expect(getImessageCursorForDevice('mac-1')).toBe(11)
    expect(getImessageCursorForDevice('mac-2')).toBe(0)
  })

  it('is idempotent by guid and device/rowid', () => {
    upsertImessageBatch('mac-1', [
      {
        guid: 'dup-guid',
        rowid: 123,
        date_ms: Date.now(),
        text: 'first',
        is_from_me: false,
        handle: null,
        chat_identifier: null,
      },
    ])
    const result = upsertImessageBatch('mac-1', [
      {
        guid: 'dup-guid',
        rowid: 123,
        date_ms: Date.now(),
        text: 'updated',
        is_from_me: false,
        handle: null,
        chat_identifier: null,
      },
    ])
    expect(result.accepted).toBe(1)
    expect(getImessageCursorForDevice('mac-1')).toBe(123)
    const hits = searchImessageMessages('updated', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.guid).toBe('dup-guid')
  })

  it('wipeImessageMessages deletes all rows', () => {
    upsertImessageBatch('mac-1', [
      {
        guid: 'wipe-1',
        rowid: 1,
        date_ms: Date.now(),
        text: 'to wipe',
        is_from_me: false,
        handle: null,
        chat_identifier: null,
      },
    ])
    const deleted = wipeImessageMessages()
    expect(deleted).toBe(1)
    expect(searchImessageMessages('wipe', 10)).toHaveLength(0)
    expect(getImessageCursorForDevice('mac-1')).toBe(0)
  })

  it('getStoredThreadMessages returns oldest first with total count', () => {
    upsertImessageBatch('mac-1', [
      {
        guid: 'th-1',
        rowid: 1,
        date_ms: Date.parse('2026-04-27T10:00:00.000Z'),
        text: 'first',
        is_from_me: false,
        handle: '+15550001111',
        chat_identifier: '+15550001111',
      },
      {
        guid: 'th-2',
        rowid: 2,
        date_ms: Date.parse('2026-04-27T10:01:00.000Z'),
        text: 'second',
        is_from_me: true,
        handle: '+15550001111',
        chat_identifier: '+15550001111',
      },
    ])
    const out = getStoredThreadMessages({
      chat_identifier: '+15550001111',
      defaultSinceMs: Date.parse('2026-04-27T00:00:00.000Z'),
      limit: 100,
    })
    expect(out.message_count).toBe(2)
    expect(out.messages.map((m) => m.text)).toEqual(['first', 'second'])
  })
})
