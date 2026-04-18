import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProfilingSystemPrompt, fetchRipmailWhoamiForProfiling, parseWhoamiProfileSubject } from './profilingAgent.js'
import { buildSeedingSystemPrompt } from './seedingAgent.js'
import { ONBOARDING_OMIT_TOOL_NAMES } from './agentFactory.js'
import { ALL_AGENT_TOOL_NAMES, buildCreateAgentToolsOptions } from './agentToolSets.js'

let wikiDir: string
beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'onboarding-agent-test-'))
})
afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
})

describe('buildSeedingSystemPrompt', () => {
  it('grounds seeding in mail + write without wiki read tools', () => {
    const userPage = { relativePath: 'people/lewis-cirne.md', slug: 'lewis-cirne' }
    const p = buildSeedingSystemPrompt('America/Los_Angeles', '- cats', userPage)
    expect(p).toMatch(/do \*\*not\*\* have wiki \*\*read\*\*/i)
    expect(p).toMatch(/never `wiki\/me\.md`/i)
    expect(p).toMatch(/never add a `wiki\/` prefix/i)
    expect(p).toContain('web_search')
    expect(p).toContain('fetch_page')
    expect(p).toMatch(/parallel page building/i)
    expect(p).toMatch(/cannot scan the vault with \*\*grep\*\*/i)
    expect(p).toMatch(/skeletal long-form page/i)
    expect(p).toContain('people/lewis-cirne.md')
    expect(p).toMatch(/Expand it/i)
    expect(p).toMatch(/Obsidian-style/i)
    expect(p).toContain('[[wikilinks]]')
    expect(p).toContain('[[me]]')
    expect(p).toContain('[[people/jane-doe]]')
  })

  it('when user people page is unknown, keeps optional fallback line', () => {
    const p = buildSeedingSystemPrompt('America/Los_Angeles', '- cats', null)
    expect(p).toMatch(/people\/\[slug\]/i)
  })
})

describe('onboarding agent tools', () => {
  it('uses createAgentTools omit list matching profiling/seeding (keeps web_search + fetch_page)', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, {
      includeLocalMessageTools: false,
      omitToolNames: ONBOARDING_OMIT_TOOL_NAMES,
    })
    const names = tools.map((t: { name?: string }) => t.name)
    for (const n of ONBOARDING_OMIT_TOOL_NAMES) {
      expect(names).not.toContain(n)
    }
    expect(names).toContain('web_search')
    expect(names).toContain('fetch_page')
    expect(names).toContain('youtube_search')
  })

  it('ALL_AGENT_TOOL_NAMES matches every tool when local messages are included', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
    const names = new Set(tools.map((t: { name?: string }) => t.name))
    for (const n of ALL_AGENT_TOOL_NAMES) {
      expect(names.has(n)).toBe(true)
    }
  })

  it('buildCreateAgentToolsOptions profiling variant omits web and youtube search tools', async () => {
    const { createAgentTools } = await import('./tools.js')
    const opts = buildCreateAgentToolsOptions({
      preset: 'onboarding',
      onboardingVariant: 'profiling',
      includeLocalMessageTools: false,
    })
    const tools = createAgentTools(wikiDir, opts)
    const names = tools.map((t: { name?: string }) => t.name)
    expect(names).not.toContain('web_search')
    expect(names).not.toContain('fetch_page')
    expect(names).not.toContain('youtube_search')
    expect(names).toContain('search_index')
  })
})

describe('buildProfilingSystemPrompt', () => {
  it('includes account identity and me.md as injected assistant context', () => {
    const p = buildProfilingSystemPrompt('America/Los_Angeles', 'user@example.com')
    expect(p).toContain('user@example.com')
    expect(p).toContain('me.md')
    expect(p).toMatch(/injected/i)
    expect(p).toMatch(/AGENTS\.md/i)
    expect(p).toMatch(/read_doc.*20/i)
  })

  it('when whoami is JSON, injects display name and email into the prompt', () => {
    const raw = JSON.stringify({
      mailboxes: [
        {
          inferred: { primaryEmail: 'lewis@example.com', displayNameFromMail: 'Lewis Cirne' },
        },
      ],
    })
    const p = buildProfilingSystemPrompt('America/Los_Angeles', raw)
    expect(p).toContain('Lewis Cirne')
    expect(p).toContain('lewis@example.com')
    expect(p).toContain('**Subject:**')
  })

  it('mentions skeletal people page when path is provided', () => {
    const p = buildProfilingSystemPrompt('America/Los_Angeles', '{}', null, {
      relativePath: 'people/lewis-cirne.md',
      slug: 'lewis-cirne',
    })
    expect(p).toContain('people/lewis-cirne.md')
    expect(p).toContain('[[people/lewis-cirne]]')
    expect(p).toMatch(/Do not.*write.*edit.*during profiling/is)
  })
})

describe('parseWhoamiProfileSubject', () => {
  it('returns inferred fields from ripmail whoami JSON', () => {
    const raw = JSON.stringify({
      mailboxes: [{ inferred: { primaryEmail: 'a@b.com', displayNameFromMail: 'A B' } }],
    })
    expect(parseWhoamiProfileSubject(raw)).toEqual({
      displayName: 'A B',
      primaryEmail: 'a@b.com',
    })
  })

  it('prefers identity full name over mail-inferred display name', () => {
    const raw = JSON.stringify({
      mailboxes: [
        {
          identity: { fullName: 'Lewis Cirne', preferredName: 'Lew' },
          inferred: { primaryEmail: 'lewis@example.com', displayNameFromMail: 'From Header' },
        },
      ],
    })
    expect(parseWhoamiProfileSubject(raw)).toEqual({
      displayName: 'Lewis Cirne',
      primaryEmail: 'lewis@example.com',
    })
  })

  it('uses preferredName when fullName is absent', () => {
    const raw = JSON.stringify({
      mailboxes: [
        {
          identity: { preferredName: 'Pat Smith' },
          inferred: { primaryEmail: 'pat@example.com' },
        },
      ],
    })
    expect(parseWhoamiProfileSubject(raw)).toEqual({
      displayName: 'Pat Smith',
      primaryEmail: 'pat@example.com',
    })
  })

  it('uses suggestedNameFromEmail when displayNameFromMail is empty', () => {
    const raw = JSON.stringify({
      mailboxes: [
        {
          inferred: {
            primaryEmail: 'lewiscirne@mac.com',
            suggestedNameFromEmail: 'Lewis Cirne',
          },
        },
      ],
    })
    expect(parseWhoamiProfileSubject(raw)).toEqual({
      displayName: 'Lewis Cirne',
      primaryEmail: 'lewiscirne@mac.com',
    })
  })

  it('returns null for non-JSON', () => {
    expect(parseWhoamiProfileSubject('not json')).toBeNull()
  })
})

describe('fetchRipmailWhoamiForProfiling', () => {
  let prevBin: string | undefined
  let prevHome: string | undefined

  beforeEach(() => {
    prevBin = process.env.RIPMAIL_BIN
    prevHome = process.env.RIPMAIL_HOME
  })

  afterEach(() => {
    if (prevBin === undefined) delete process.env.RIPMAIL_BIN
    else process.env.RIPMAIL_BIN = prevBin
    if (prevHome === undefined) delete process.env.RIPMAIL_HOME
    else process.env.RIPMAIL_HOME = prevHome
  })

  it('returns stdout from ripmail whoami', async () => {
    const fake = join(wikiDir, 'fake-ripmail-whoami')
    await writeFile(
      fake,
      `#!/bin/sh
if [ "$1" = whoami ]; then echo "identity line"; else exit 1; fi
`,
      'utf8',
    )
    await chmod(fake, 0o755)
    process.env.RIPMAIL_BIN = fake
    process.env.RIPMAIL_HOME = join(wikiDir, 'ripmail-home')

    const out = await fetchRipmailWhoamiForProfiling()
    expect(out).toBe('identity line')
  })
})
