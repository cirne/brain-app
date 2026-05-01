import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  initLocalMessageToolsAvailability,
  resetLocalMessageToolsAvailabilityForTests,
} from '@server/lib/apple/imessageDb.js'
import { upsertImessageBatch } from '@server/lib/messages/messagesDb.js'

let dir: string
let app: Hono

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'imessage-api-test-'))
  process.env.BRAIN_HOME = dir

  const now = Date.now()
  const t1 = now - 2 * 24 * 60 * 60 * 1000
  const t2 = now - 1 * 24 * 60 * 60 * 1000
  upsertImessageBatch('fixture-device', [
    {
      guid: 'msg-guid-1',
      rowid: 1,
      date_ms: t1,
      text: 'Hello',
      is_from_me: false,
      handle: null,
      chat_identifier: '+15550001111',
      display_name: 'Alice',
      contact_identifier: null,
      organization: null,
      service: 'iMessage',
    },
    {
      guid: 'msg-guid-2',
      rowid: 2,
      date_ms: t2,
      text: 'Reply',
      is_from_me: true,
      handle: null,
      chat_identifier: '+15550001111',
      display_name: 'Alice',
      contact_identifier: null,
      organization: null,
      service: 'iMessage',
    },
  ])

  const { default: imessageRoute } = await import('./imessage.js')
  app = new Hono()
  app.route('/api/imessage', imessageRoute)
  app.route('/api/messages', imessageRoute)
})

afterEach(async () => {
  delete process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
  delete process.env.IMESSAGE_DB_PATH
  delete process.env.BRAIN_HOME
  resetLocalMessageToolsAvailabilityForTests()
  await rm(dir, { recursive: true, force: true })
})

describe('GET /api/imessage/thread', () => {
  it('returns compact messages for canonical chat query (hosted index)', async () => {
    const res = await app.request('/api/imessage/thread?chat=%2B15550001111')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      chat?: string
      canonical_chat?: string
      messages?: Array<{ sent_at_unix: number; is_from_me: boolean; text: string }>
      returned_count?: number
      hosted_source?: boolean
    }
    expect(body.ok).toBe(true)
    expect(body.hosted_source).toBe(true)
    expect(body.canonical_chat).toBe('+15550001111')
    expect(body.messages?.map((m) => m.text)).toEqual(['Hello', 'Reply'])
  })

  it('GET /api/messages/thread is an alias for the same handler', async () => {
    const res = await app.request('/api/messages/thread?chat=%2B15550001111')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; canonical_chat?: string }
    expect(body.ok).toBe(true)
    expect(body.canonical_chat).toBe('+15550001111')
  })

  it('returns 400 when chat is missing', async () => {
    const res = await app.request('/api/imessage/thread')
    expect(res.status).toBe(400)
  })

  it('falls back to hosted message store when local messages are disabled', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'imessage-hosted-only-'))
    const prevHome = process.env.BRAIN_HOME
    process.env.BRAIN_HOME = isolated
    try {
      process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = '1'
      process.env.IMESSAGE_DB_PATH = join(isolated, 'missing-chat.db')
      resetLocalMessageToolsAvailabilityForTests()
      initLocalMessageToolsAvailability()
      upsertImessageBatch('cloud-mac', [
        {
          guid: 'cloud-msg-1',
          rowid: 42,
          date_ms: Date.now(),
          text: 'from hosted index',
          is_from_me: false,
          handle: '+15550001111',
          chat_identifier: '+15550001111',
          display_name: 'Alice',
          contact_identifier: null,
          organization: null,
          service: 'iMessage',
        },
      ])
      const { default: imessageRoute } = await import('./imessage.js')
      const app2 = new Hono()
      app2.route('/api/messages', imessageRoute)
      const res = await app2.request('/api/messages/thread?chat=%2B15550001111')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { hosted_source?: boolean; messages?: Array<{ text: string }> }
      expect(body.hosted_source).toBe(true)
      expect(body.messages?.map((m) => m.text)).toEqual(['from hosted index'])
    } finally {
      process.env.BRAIN_HOME = prevHome
      delete process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
      delete process.env.IMESSAGE_DB_PATH
      resetLocalMessageToolsAvailabilityForTests()
      await rm(isolated, { recursive: true, force: true })
    }
  })
})
