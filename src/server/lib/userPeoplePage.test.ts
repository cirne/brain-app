import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureUserPeoplePageSkeleton, slugFromUserIdentity, userPeoplePageRelativePath } from './userPeoplePage.js'

describe('slugFromUserIdentity', () => {
  it('kebab-cases display names', () => {
    expect(slugFromUserIdentity({ displayName: 'Lewis Cirne', primaryEmail: 'a@b.com' })).toBe('lewis-cirne')
  })

  it('falls back to email local part', () => {
    expect(slugFromUserIdentity({ displayName: '', primaryEmail: 'pat.smith@example.com' })).toBe('pat-smith')
  })
})

describe('userPeoplePageRelativePath', () => {
  it('prefixes people/', () => {
    expect(userPeoplePageRelativePath('lewis-cirne')).toBe('people/lewis-cirne.md')
  })
})

describe('ensureUserPeoplePageSkeleton', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'user-people-page-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes skeleton once and preserves later calls', async () => {
    const id = { displayName: 'Lewis Cirne', primaryEmail: 'lew@example.com' }
    const a = await ensureUserPeoplePageSkeleton(dir, id)
    expect(a.relativePath).toBe('people/lewis-cirne.md')
    const body1 = await readFile(join(dir, a.relativePath), 'utf-8')
    expect(body1).toContain('# Lewis Cirne')
    expect(body1).toContain('<!-- brain: user-page-skeleton -->')

    const b = await ensureUserPeoplePageSkeleton(dir, id)
    expect(b.relativePath).toBe(a.relativePath)
    const body2 = await readFile(join(dir, a.relativePath), 'utf-8')
    expect(body2).toBe(body1)
  })
})
