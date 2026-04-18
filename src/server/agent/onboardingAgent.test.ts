import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProfilingSystemPrompt, fetchRipmailWhoamiForProfiling, parseWhoamiProfileSubject } from './profilingAgent.js'
import { buildSeedingSystemPrompt } from './seedingAgent.js'
import { ONBOARDING_OMIT_TOOL_NAMES } from './agentFactory.js'

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
    expect(p).toMatch(/parallel/i)
    expect(p).toMatch(/final pass/i)
    expect(p).toMatch(/internal wiki links/i)
    expect(p).toMatch(/Do not.*write a separate page about.*main user/i)
    expect(p).toContain('**me.md** is already their profile')
    expect(p).toMatch(/Obsidian-style/i)
    expect(p).toContain('[[wikilinks]]')
    expect(p).toContain('[[me]]')
    expect(p).toContain('[[people/jane-doe]]')
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
})

describe('buildProfilingSystemPrompt', () => {
  it('produces a short recipe with the account identity', () => {
    const p = buildProfilingSystemPrompt('America/Los_Angeles', 'user@example.com')
    expect(p).toContain('user@example.com')
    expect(p).toContain('## Key people')
    expect(p).toContain('## Interests')
    expect(p).toContain('## Work')
    expect(p).toContain('## Contact')
    expect(p).toContain('me.md')
    expect(p).toMatch(/Steps/)
  })

  it('when whoami is JSON, injects display name and email into the recipe', () => {
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
    expect(p).toContain('# Lewis Cirne')
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
