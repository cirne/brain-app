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
    expect(s).toContain('wiki first, then mail')
    expect(s).toMatch(/wiki.*first/i)
    expect(s).toMatch(/\*\*Do not\*\* treat a wiki hit as a complete answer/i)
    expect(s).toMatch(/wiki.*work in progress/i)
    expect(s).toMatch(/latest dated source/i)
    expect(s).toContain('search_index')
    expect(s).toContain('read_email')
    expect(s).not.toContain("If the wiki doesn't have it")
    expect(s).not.toContain('local Messages tools')
    expect(s).not.toContain('list_recent_messages')
  })

  it('steers chat wiki toward narrow capture and Chat capture provenance (OPP-066)', async () => {
    const { buildBaseSystemPrompt } = await import('./assistantAgent.js')
    const s = buildBaseSystemPrompt(false, wiki)
    expect(s).toContain('chat = narrow capture')
    expect(s).toMatch(/narrow and question-scoped/i)
    expect(s).toContain('## Chat capture')
    expect(s).toMatch(/WikiBuilder/i)
    expect(s).toContain('wiki-edits.jsonl')
  })

  it('mentions suggest_reply_options and bans bracket placeholder text', async () => {
    const { buildBaseSystemPrompt } = await import('./assistantAgent.js')
    const s = buildBaseSystemPrompt(false, wiki)
    expect(s).toContain('[suggest_reply_options]')
    expect(s).toContain('Quick replies')
    expect(s).toContain('suggest_reply_options')
  })

  it('injects assistant.md when the file exists', async () => {
    await writeFile(join(wiki, 'assistant.md'), '# Assistant\n\nBe brief.', 'utf-8')
    const { buildBaseSystemPrompt } = await import('./assistantAgent.js')
    const s = buildBaseSystemPrompt(false, wiki)
    expect(s).toContain('Assistant identity & charter (assistant.md)')
    expect(s).toContain('<<<BEGIN_ASSISTANT_PROFILE_FROM_ASSISTANT_MD>>>')
    expect(s).toContain('<<<END_ASSISTANT_PROFILE_FROM_ASSISTANT_MD>>>')
    expect(s).toContain('# Assistant')
    expect(s).toContain('Be brief.')
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

describe('assistantProfilePromptSection', () => {
  it('is empty when assistant.md is missing', async () => {
    const { assistantProfilePromptSection } = await import('./index.js')
    expect(assistantProfilePromptSection(wiki)).toBe('')
  })

  it('injects assistant.md body and markers when file exists', async () => {
    await writeFile(join(wiki, 'assistant.md'), '# Asst\n\nVoice: calm.', 'utf-8')
    const { assistantProfilePromptSection } = await import('./index.js')
    const s = assistantProfilePromptSection(wiki)
    expect(s).toContain('Assistant identity & charter (assistant.md)')
    expect(s).toContain('<<<BEGIN_ASSISTANT_PROFILE_FROM_ASSISTANT_MD>>>')
    expect(s).toContain('<<<END_ASSISTANT_PROFILE_FROM_ASSISTANT_MD>>>')
    expect(s).toContain('# Asst')
    expect(s).toContain('Voice: calm.')
  })
})
