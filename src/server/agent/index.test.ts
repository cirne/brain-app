import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let brainHome: string
let wiki: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'agent-wiki-'))
  process.env.BRAIN_HOME = brainHome
  wiki = join(brainHome, 'wiki')
  await mkdir(wiki, { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('buildBaseSystemPrompt', () => {
  it('prefers wiki lookup before mail for general questions', async () => {
    const { buildBaseSystemPrompt } = await import('./assistantAgent.js')
    const s = buildBaseSystemPrompt(false, wiki)
    expect(s).toContain('Wiki first, then mail')
    expect(s).toMatch(/wiki.*first/i)
    expect(s).toContain('search_index')
    expect(s).toContain('read_email')
  })
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
