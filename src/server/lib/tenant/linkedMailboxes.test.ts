import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  findLinkedMailboxByEmail,
  findLinkedMailboxBySub,
  linkedMailboxesPath,
  readLinkedMailboxes,
  removeLinkedMailbox,
  upsertLinkedMailbox,
} from './linkedMailboxes.js'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'linked-mailboxes-'))
  process.env.BRAIN_HOME = home
  delete process.env.BRAIN_DATA_ROOT
})

afterEach(async () => {
  delete process.env.BRAIN_HOME
  await rm(home, { recursive: true, force: true })
})

describe('linkedMailboxes store', () => {
  it('returns an empty doc when the file is missing', async () => {
    const doc = await readLinkedMailboxes()
    expect(doc).toEqual({ v: 1, mailboxes: [] })
    expect(existsSync(linkedMailboxesPath())).toBe(false)
  })

  it('upsert adds new entry and reports added=true', async () => {
    const r = await upsertLinkedMailbox({
      email: 'Work@Example.com',
      googleSub: 'sub-1',
      isPrimary: true,
      nowIso: '2026-04-26T12:00:00.000Z',
    })
    expect(r.added).toBe(true)
    expect(r.entry.email).toBe('work@example.com')
    expect(r.entry.googleSub).toBe('sub-1')
    expect(r.entry.isPrimary).toBe(true)
    expect(r.entry.linkedAt).toBe('2026-04-26T12:00:00.000Z')

    const raw = await readFile(linkedMailboxesPath(), 'utf8')
    const j = JSON.parse(raw) as { mailboxes: { email: string }[] }
    expect(j.mailboxes).toHaveLength(1)
    expect(j.mailboxes[0].email).toBe('work@example.com')
  })

  it('upsert re-linking the same email refreshes sub and keeps linkedAt + isPrimary', async () => {
    await upsertLinkedMailbox({
      email: 'work@example.com',
      googleSub: 'sub-1',
      isPrimary: true,
      nowIso: '2026-04-26T12:00:00.000Z',
    })
    const r = await upsertLinkedMailbox({
      email: 'work@example.com',
      googleSub: 'sub-2',
    })
    expect(r.added).toBe(false)
    expect(r.entry.googleSub).toBe('sub-2')
    expect(r.entry.linkedAt).toBe('2026-04-26T12:00:00.000Z')
    expect(r.entry.isPrimary).toBe(true)
  })

  it('upsert preserves isPrimary=true on subsequent non-primary updates', async () => {
    await upsertLinkedMailbox({
      email: 'work@example.com',
      googleSub: 'sub-1',
      isPrimary: true,
    })
    const r = await upsertLinkedMailbox({
      email: 'work@example.com',
      googleSub: 'sub-1',
    })
    expect(r.entry.isPrimary).toBe(true)
  })

  it('findByEmail and findBySub respect case insensitivity for email and exact match for sub', async () => {
    await upsertLinkedMailbox({ email: 'a@gmail.com', googleSub: 'sub-a' })
    await upsertLinkedMailbox({ email: 'b@gmail.com', googleSub: 'sub-b' })
    expect(await findLinkedMailboxByEmail('A@Gmail.com')).not.toBeNull()
    expect(await findLinkedMailboxBySub('sub-b')).not.toBeNull()
    expect(await findLinkedMailboxBySub('sub-c')).toBeNull()
  })

  it('removeLinkedMailbox returns true only when an entry was dropped', async () => {
    await upsertLinkedMailbox({ email: 'a@gmail.com', googleSub: 'sub-a' })
    expect(await removeLinkedMailbox('A@Gmail.com')).toBe(true)
    expect(await removeLinkedMailbox('a@gmail.com')).toBe(false)
    const doc = await readLinkedMailboxes()
    expect(doc.mailboxes).toHaveLength(0)
  })

  it('readLinkedMailboxes ignores malformed rows', async () => {
    await upsertLinkedMailbox({ email: 'a@gmail.com', googleSub: 'sub-a' })
    const path = linkedMailboxesPath()
    const broken = {
      v: 1,
      mailboxes: [
        { email: 'a@gmail.com', googleSub: 'sub-a', linkedAt: '2026-04-26T00:00:00.000Z' },
        { email: '', googleSub: 'x', linkedAt: 'now' },
        { email: 'b@b', googleSub: '', linkedAt: 'now' },
        null,
        'oops',
      ],
    }
    await rm(path)
    await import('node:fs/promises').then((m) => m.writeFile(path, JSON.stringify(broken), 'utf-8'))
    const doc = await readLinkedMailboxes()
    expect(doc.mailboxes).toHaveLength(1)
    expect(doc.mailboxes[0].email).toBe('a@gmail.com')
  })
})
