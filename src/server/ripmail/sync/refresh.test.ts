import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { closeRipmailDb } from '../db.js'

const syncGmailSource = vi.hoisted(() =>
  vi.fn(async () => ({
    sourceId: 'gsrc',
    messagesAdded: 0,
    messagesUpdated: 0,
    error: 'Error: invalid_grant',
  })),
)
const syncGoogleCalendarSource = vi.hoisted(() =>
  vi.fn(async () => ({
    sourceId: 'gsrc-gcal',
    eventsUpserted: 0,
    eventsDeleted: 0,
  })),
)

vi.mock('./gmail.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gmail.js')>()
  return { ...actual, syncGmailSource }
})

vi.mock('./googleCalendar.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./googleCalendar.js')>()
  return { ...actual, syncGoogleCalendarSource }
})

import { refresh } from './index.js'

describe('refresh Gmail invalid_grant', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'rip-refresh-ig-'))
    mkdirSync(join(home, 'gsrc'), { recursive: true })
    writeFileSync(
      join(home, 'gsrc', 'google-oauth.json'),
      JSON.stringify({ refreshToken: 'dead', accessToken: 'x' }),
      'utf8',
    )
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'gsrc',
            kind: 'imap',
            email: 'a@gmail.com',
            imapAuth: 'googleOAuth',
            imap: { host: 'imap.gmail.com', port: 993, user: 'a@gmail.com' },
          },
          {
            id: 'gsrc-gcal',
            kind: 'googleCalendar',
            email: 'a@gmail.com',
            oauthSourceId: 'gsrc',
            calendarIds: ['primary'],
          },
        ],
      }),
      'utf8',
    )
    syncGmailSource.mockClear()
    syncGmailSource.mockResolvedValue({
      sourceId: 'gsrc',
      messagesAdded: 0,
      messagesUpdated: 0,
      error: 'Error: invalid_grant',
    })
    syncGoogleCalendarSource.mockClear()
    syncGoogleCalendarSource.mockResolvedValue({
      sourceId: 'gsrc-gcal',
      eventsUpserted: 0,
      eventsDeleted: 0,
    })
  })

  afterEach(() => {
    closeRipmailDb(home)
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('deletes google-oauth.json after invalid_grant from syncGmailSource', async () => {
    const tokenPath = join(home, 'gsrc', 'google-oauth.json')
    expect(existsSync(tokenPath)).toBe(true)
    await refresh(home)
    expect(existsSync(tokenPath)).toBe(false)
    expect(syncGmailSource).toHaveBeenCalledTimes(1)
    expect(syncGoogleCalendarSource).toHaveBeenCalledTimes(1)
  })

  it('does not delete oauth file when sync error is not invalid_grant', async () => {
    syncGmailSource.mockResolvedValue({
      sourceId: 'gsrc',
      messagesAdded: 0,
      messagesUpdated: 0,
      error: 'Error: network down',
    })
    const tokenPath = join(home, 'gsrc', 'google-oauth.json')
    await refresh(home)
    expect(existsSync(tokenPath)).toBe(true)
  })

  it('refreshes only the requested googleCalendar source when sourceId is calendar-only', async () => {
    await refresh(home, { sourceId: 'gsrc-gcal' })
    expect(syncGmailSource).not.toHaveBeenCalled()
    expect(syncGoogleCalendarSource).toHaveBeenCalledTimes(1)
    expect(syncGoogleCalendarSource).toHaveBeenCalledWith(
      expect.anything(),
      home,
      expect.objectContaining({ id: 'gsrc-gcal', kind: 'googleCalendar' }),
    )
  })
})
