import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let wiki: string

beforeEach(async () => {
  wiki = await mkdtemp(join(tmpdir(), 'agent-wiki-'))
  process.env.WIKI_DIR = wiki
})

afterEach(async () => {
  await rm(wiki, { recursive: true, force: true })
  delete process.env.WIKI_DIR
})

describe('meProfilePromptSection', () => {
  it('is empty when me.md is missing', async () => {
    const { meProfilePromptSection } = await import('./index.js')
    expect(meProfilePromptSection(wiki)).toBe('')
  })

  it('injects me.md body and instruction when file exists', async () => {
    await writeFile(join(wiki, 'me.md'), '# Me\n\nLew', 'utf-8')
    const { meProfilePromptSection } = await import('./index.js')
    const s = meProfilePromptSection(wiki)
    expect(s).toContain('User profile (me.md)')
    expect(s).toContain('read tool for')
    expect(s).toContain('<<<BEGIN_USER_PROFILE_FROM_ME_MD>>>')
    expect(s).toContain('<<<END_USER_PROFILE_FROM_ME_MD>>>')
    expect(s).toContain('# Me')
    expect(s).toContain('Lew')
  })
})
