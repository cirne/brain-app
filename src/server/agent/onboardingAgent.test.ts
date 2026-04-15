import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildProfilingSystemPrompt,
  buildSeedingSystemPrompt,
  fetchRipmailWhoamiForProfiling,
  ONBOARDING_OMIT_TOOL_NAMES,
} from './onboardingAgent.js'

let wikiDir: string
beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'onboarding-agent-test-'))
})
afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
})

describe('buildSeedingSystemPrompt', () => {
  it('tells the agent to read me.md at the wiki root, not wiki/me.md', () => {
    const p = buildSeedingSystemPrompt('America/Los_Angeles', '- cats')
    expect(p).toMatch(/read.*`me\.md`/i)
    expect(p).toContain('not `wiki/me.md`')
    expect(p).toMatch(/never add a `wiki\/` prefix/i)
    expect(p).toContain('web_search')
    expect(p).toContain('fetch_page')
  })
})

describe('onboarding agent tools', () => {
  it('uses createAgentTools omit list matching profiling/seeding (keeps web_search + fetch_page)', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, {
      includeImessageTools: false,
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
})

describe('buildProfilingSystemPrompt', () => {
  it('asks for a concise essentials profile, not a dossier', () => {
    const p = buildProfilingSystemPrompt('America/Los_Angeles', 'user@example.com')
    expect(p).toMatch(/not.*dossier/)
    expect(p).toContain('## Identity (authoritative)')
    expect(p).toContain('user@example.com')
    expect(p).toContain('## Name')
    expect(p).toContain('## Key people')
    expect(p).toContain('## Interests')
    expect(p).toContain('## Projects & work')
    expect(p).toContain('## Contact')
    expect(p).toContain('25–45 lines')
    expect(p).toContain('wiki/me.md')
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
