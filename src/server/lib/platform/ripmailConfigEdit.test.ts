import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ensureSingleSourceMarkedAsDefaultSend,
  imapSourceExists,
  listImapSourcesWithVisibility,
  readDefaultSendSource,
  setDefaultSendSource,
  setSourceIncludeInDefault,
  sourceIncludedInDefaultSearch,
} from './ripmailConfigEdit.js'

let ripmailHome: string

async function writeConfig(cfg: unknown): Promise<void> {
  await mkdir(ripmailHome, { recursive: true })
  await writeFile(join(ripmailHome, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8')
}

beforeEach(async () => {
  ripmailHome = await mkdtemp(join(tmpdir(), 'ripmail-config-edit-'))
})

afterEach(async () => {
  await rm(ripmailHome, { recursive: true, force: true })
})

describe('ripmailConfigEdit helpers', () => {
  it('sourceIncludedInDefaultSearch defaults to true and only flips on explicit false', () => {
    expect(sourceIncludedInDefaultSearch(undefined)).toBe(false)
    expect(
      sourceIncludedInDefaultSearch({
        id: 'a',
        kind: 'imap',
        email: 'a@example.com',
        imap: { host: 'imap.gmail.com', port: 993 },
        imapAuth: 'googleOAuth',
      }),
    ).toBe(true)
    expect(
      sourceIncludedInDefaultSearch({
        id: 'a',
        kind: 'imap',
        email: 'a@example.com',
        imap: { host: 'imap.gmail.com', port: 993 },
        imapAuth: 'googleOAuth',
        search: { includeInDefault: false },
      }),
    ).toBe(false)
  })

  it('listImapSourcesWithVisibility surfaces default flag for each IMAP source', async () => {
    await writeConfig({
      sources: [
        {
          id: 'a_gmail_com',
          kind: 'imap',
          email: 'a@gmail.com',
          imap: { host: 'imap.gmail.com', port: 993 },
          imapAuth: 'googleOAuth',
        },
        {
          id: 'b_gmail_com',
          kind: 'imap',
          email: 'b@gmail.com',
          imap: { host: 'imap.gmail.com', port: 993 },
          imapAuth: 'googleOAuth',
          search: { includeInDefault: false },
        },
        { id: 'a_gmail_com-gcal', kind: 'googleCalendar', email: 'a@gmail.com', oauthSourceId: 'a_gmail_com' },
      ],
    })
    const rows = await listImapSourcesWithVisibility(ripmailHome)
    expect(rows).toEqual([
      { id: 'a_gmail_com', email: 'a@gmail.com', includeInDefault: true },
      { id: 'b_gmail_com', email: 'b@gmail.com', includeInDefault: false },
    ])
  })

  it('imapSourceExists matches IMAP sources only', async () => {
    await writeConfig({
      sources: [
        { id: 'a_gmail_com', kind: 'imap', email: 'a@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
        { id: 'cal', kind: 'googleCalendar', email: 'a@gmail.com', oauthSourceId: 'a_gmail_com' },
      ],
    })
    expect(await imapSourceExists(ripmailHome, 'a_gmail_com')).toBe(true)
    expect(await imapSourceExists(ripmailHome, 'cal')).toBe(false)
    expect(await imapSourceExists(ripmailHome, 'unknown')).toBe(false)
  })

  it('setSourceIncludeInDefault flips the flag and removes it when re-enabled', async () => {
    await writeConfig({
      sources: [
        { id: 'a', kind: 'imap', email: 'a@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
      ],
    })

    const offRes = await setSourceIncludeInDefault(ripmailHome, 'a', false)
    expect(offRes.ok).toBe(true)
    let raw = JSON.parse(await readFile(join(ripmailHome, 'config.json'), 'utf8')) as { sources: { search?: { includeInDefault?: boolean } }[] }
    expect(raw.sources[0].search?.includeInDefault).toBe(false)

    const onRes = await setSourceIncludeInDefault(ripmailHome, 'a', true)
    expect(onRes.ok).toBe(true)
    raw = JSON.parse(await readFile(join(ripmailHome, 'config.json'), 'utf8')) as { sources: { search?: { includeInDefault?: boolean } }[] }
    expect(raw.sources[0].search).toBeUndefined()
  })

  it('setSourceIncludeInDefault returns errors for missing or non-IMAP ids', async () => {
    await writeConfig({
      sources: [
        { id: 'cal', kind: 'googleCalendar', email: 'a@gmail.com', oauthSourceId: 'a' },
      ],
    })
    expect(await setSourceIncludeInDefault(ripmailHome, '', true)).toEqual({ ok: false, error: 'not_found' })
    expect(await setSourceIncludeInDefault(ripmailHome, 'missing', false)).toEqual({ ok: false, error: 'not_found' })
    expect(await setSourceIncludeInDefault(ripmailHome, 'cal', false)).toEqual({ ok: false, error: 'invalid_kind' })
  })

  it('setDefaultSendSource validates id, persists, and clears with null', async () => {
    await writeConfig({
      sources: [
        { id: 'a', kind: 'imap', email: 'a@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
        { id: 'b', kind: 'imap', email: 'b@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
      ],
    })

    const setRes = await setDefaultSendSource(ripmailHome, 'b')
    expect(setRes).toEqual({ ok: true, defaultSendSource: 'b' })
    expect(await readDefaultSendSource(ripmailHome)).toBe('b')

    const clearRes = await setDefaultSendSource(ripmailHome, null)
    expect(clearRes).toEqual({ ok: true, defaultSendSource: null })
    expect(await readDefaultSendSource(ripmailHome)).toBeNull()
  })

  it('setDefaultSendSource refuses missing ids and non-IMAP sources', async () => {
    await writeConfig({
      sources: [
        { id: 'cal', kind: 'googleCalendar', email: 'a@gmail.com', oauthSourceId: 'a' },
      ],
    })
    expect(await setDefaultSendSource(ripmailHome, 'a')).toEqual({ ok: false, error: 'not_found' })
    expect(await setDefaultSendSource(ripmailHome, 'cal')).toEqual({ ok: false, error: 'invalid_kind' })
  })

  it('ensureSingleSourceMarkedAsDefaultSend promotes the only IMAP source once', async () => {
    await writeConfig({
      sources: [
        { id: 'only', kind: 'imap', email: 'a@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
      ],
    })
    expect(await ensureSingleSourceMarkedAsDefaultSend(ripmailHome)).toBe('only')
    expect(await readDefaultSendSource(ripmailHome)).toBe('only')
    expect(await ensureSingleSourceMarkedAsDefaultSend(ripmailHome)).toBeNull()
  })

  it('ensureSingleSourceMarkedAsDefaultSend is a no-op when multiple IMAP sources exist', async () => {
    await writeConfig({
      sources: [
        { id: 'a', kind: 'imap', email: 'a@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
        { id: 'b', kind: 'imap', email: 'b@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
      ],
    })
    expect(await ensureSingleSourceMarkedAsDefaultSend(ripmailHome)).toBeNull()
    expect(await readDefaultSendSource(ripmailHome)).toBeNull()
  })
})
