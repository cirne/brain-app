import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import {
  errorMessageIndicatesInvalidGoogleGrant,
  removeGoogleOAuthTokenFile,
  collectGoogleCalendarDefaultCalendarIds,
} from './config.js'

describe('errorMessageIndicatesInvalidGoogleGrant', () => {
  it('detects invalid_grant in Error-wrapped and JSON-like strings', () => {
    expect(errorMessageIndicatesInvalidGoogleGrant('Error: invalid_grant')).toBe(true)
    expect(errorMessageIndicatesInvalidGoogleGrant('GaxiosError: invalid_grant')).toBe(true)
    expect(errorMessageIndicatesInvalidGoogleGrant('{"error":"invalid_grant"}')).toBe(true)
    expect(errorMessageIndicatesInvalidGoogleGrant('something else')).toBe(false)
  })
})

describe('collectGoogleCalendarDefaultCalendarIds', () => {
  it('returns defaultCalendars when set', () => {
    expect(
      collectGoogleCalendarDefaultCalendarIds({
        sources: [
          {
            id: 'g',
            kind: 'googleCalendar',
            calendarIds: ['a', 'b'],
            defaultCalendars: ['  lew@gmail.com ', 'lew@gmail.com'],
          },
        ],
      }),
    ).toEqual(['lew@gmail.com'])
  })

  it('returns the sole calendarIds entry when defaultCalendars unset', () => {
    expect(
      collectGoogleCalendarDefaultCalendarIds({
        sources: [{ id: 'g', kind: 'googleCalendar', calendarIds: ['only'] }],
      }),
    ).toEqual(['only'])
  })

  it('returns empty when multiple calendarIds and no defaults', () => {
    expect(
      collectGoogleCalendarDefaultCalendarIds({
        sources: [{ id: 'g', kind: 'googleCalendar', calendarIds: ['a', 'b'] }],
      }),
    ).toEqual([])
  })

  it('ignores non-google sources', () => {
    expect(
      collectGoogleCalendarDefaultCalendarIds({
        sources: [{ id: 'a', kind: 'appleCalendar', calendarIds: ['x'] }],
      }),
    ).toEqual([])
  })
})

describe('removeGoogleOAuthTokenFile', () => {
  let home: string

  afterEach(() => {
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('removes google-oauth.json when present and returns true', async () => {
    home = await mkdtemp(join(tmpdir(), 'rm-oauth-'))
    const sid = 'mailbox_x'
    mkdirSync(join(home, sid), { recursive: true })
    const p = join(home, sid, 'google-oauth.json')
    writeFileSync(p, '{}\n', 'utf8')
    expect(removeGoogleOAuthTokenFile(home, sid)).toBe(true)
    expect(existsSync(p)).toBe(false)
  })

  it('returns false when file is absent', async () => {
    home = await mkdtemp(join(tmpdir(), 'rm-oauth-miss-'))
    mkdirSync(join(home, 's'), { recursive: true })
    expect(removeGoogleOAuthTokenFile(home, 's')).toBe(false)
  })
})
