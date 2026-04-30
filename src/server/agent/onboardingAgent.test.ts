import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildProfilingSystemPrompt,
  fetchRipmailWhoamiForProfiling,
  parseWhoamiProfileSubject,
  PROFILING_ME_MD_MAX_WORDS,
} from './profilingAgent.js'
import {
  buildWikiBuildoutFirstRunScopeNote,
  buildWikiBuildoutReturningScopeNote,
  buildWikiBuildoutSystemPrompt,
} from './wikiBuildoutAgent.js'
import { ONBOARDING_BASE_OMIT } from './agentToolSets.js'
import { ALL_AGENT_TOOL_NAMES, buildCreateAgentToolsOptions, ONBOARDING_BUILDOUT_OMIT } from './agentToolSets.js'

let wikiDir: string
beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'onboarding-agent-test-'))
})
afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
})

describe('buildWikiBuildoutFirstRunScopeNote', () => {
  it('describes starter template folders aligned with seeded vault layout', () => {
    const n = buildWikiBuildoutFirstRunScopeNote()
    expect(n).toMatch(/people\/.*projects\/.*topics\//s)
    expect(n).toContain('template.md')
  })
})

describe('buildWikiBuildoutSystemPrompt', () => {
  it('grounds buildout in mail + wiki read tools (first run)', () => {
    const userPage = { relativePath: 'people/lewis-cirne.md', slug: 'lewis-cirne' }
    const p = buildWikiBuildoutSystemPrompt('America/Los_Angeles', userPage, {
      isFirstBuildoutRun: true,
    })
    expect(p).toMatch(/`read`.*`grep`.*`find`/i)
    expect(p).toMatch(/never `wiki\/me\.md`/i)
    expect(p).toMatch(/never add a `wiki\/` prefix/i)
    expect(p).toContain('web_search')
    expect(p).toContain('fetch_page')
    expect(p).toMatch(/Parallel writes/i)
    expect(p).toMatch(/grep.*existing paths/i)
    expect(p).toMatch(/compact/i)
    expect(p).toContain('people/lewis-cirne.md')
    expect(p).toMatch(/starter layout/i)
    expect(p).toMatch(/template\.md/i)
    expect(p).not.toMatch(/Optional interview focus/i)
    expect(p).not.toContain('- cats')
    expect(p).toMatch(/Obsidian-style/i)
    expect(p).toContain('[[wikilinks]]')
    expect(p).toContain('[[me]]')
    expect(p).toContain('[[people/jane-doe]]')
    expect(p).toMatch(/newest relevant/i)
    expect(p).toMatch(/conflict.*latest dated/i)
    expect(p).toMatch(/Contact.*Identifiers/i)
    expect(p).toMatch(/Never.*invent phone/i)
    expect(p).not.toContain('list_recent_messages')
  })

  it('omits starter layout after first run', () => {
    const userPage = { relativePath: 'people/lewis-cirne.md', slug: 'lewis-cirne' }
    const p = buildWikiBuildoutSystemPrompt('America/Los_Angeles', userPage, {
      isFirstBuildoutRun: false,
    })
    expect(p).toMatch(/\*\*later\*\* enrichment pass/i)
    expect(p).toMatch(/vault manifest/i)
    expect(p).not.toMatch(/starter layout/i)
    expect(p).not.toMatch(/Optional interview focus/i)
    expect(p).toMatch(/treat that as the map/i)
  })

  it('exposes returning scope copy via buildWikiBuildoutReturningScopeNote', () => {
    const n = buildWikiBuildoutReturningScopeNote()
    expect(n).toMatch(/vault manifest/i)
    expect(n).not.toMatch(/template\.md/i)
  })

  it('when local messages are available for buildout, mentions Message tools and workflow', () => {
    const userPage = { relativePath: 'people/lewis-cirne.md', slug: 'lewis-cirne' }
    const p = buildWikiBuildoutSystemPrompt('America/Los_Angeles', userPage, {
      localMessagesAvailable: true,
    })
    expect(p).toContain('list_recent_messages')
    expect(p).toContain('get_message_thread')
    expect(p).toMatch(/Local Messages \(optional\)/i)
  })

  it('when user people page is unknown, keeps optional fallback line', () => {
    const p = buildWikiBuildoutSystemPrompt('America/Los_Angeles', null, {
      isFirstBuildoutRun: true,
    })
    expect(p).toMatch(/people\/\[slug\]/i)
  })
})

describe('onboarding agent tools', () => {
  it('uses createAgentTools omit list matching profiling/buildout (keeps web_search + fetch_page)', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, {
      includeLocalMessageTools: false,
      omitToolNames: ONBOARDING_BASE_OMIT,
    })
    const names = tools.map((t: { name?: string }) => t.name)
    for (const n of ONBOARDING_BASE_OMIT) {
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
    expect(names).not.toContain('set_chat_title')
    expect(names).toContain('search_index')
  })

  it('onboarding buildout preset with local messages includes list_recent_messages and get_message_thread', async () => {
    const { createAgentTools } = await import('./tools.js')
    const opts = buildCreateAgentToolsOptions({
      preset: 'onboarding',
      onboardingVariant: 'buildout',
      includeLocalMessageTools: true,
    })
    const tools = createAgentTools(wikiDir, opts)
    const names = tools.map((t: { name?: string }) => t.name)
    expect(names).toContain('list_recent_messages')
    expect(names).toContain('get_message_thread')
    expect(names).toContain('web_search')
  })

  it('onboarding buildout preset includes read, grep, and find for inspecting existing vault pages', async () => {
    const { createAgentTools } = await import('./tools.js')
    const opts = buildCreateAgentToolsOptions({
      preset: 'onboarding',
      onboardingVariant: 'buildout',
      includeLocalMessageTools: false,
    })
    const tools = createAgentTools(wikiDir, opts)
    const names = tools.map((t: { name?: string }) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('grep')
    expect(names).toContain('find')
  })

  it('ONBOARDING_BUILDOUT_OMIT does not drop local message tool names or wiki read tools', () => {
    expect(ONBOARDING_BUILDOUT_OMIT).not.toContain('list_recent_messages')
    expect(ONBOARDING_BUILDOUT_OMIT).not.toContain('get_message_thread')
    expect(ONBOARDING_BUILDOUT_OMIT).not.toContain('read')
    expect(ONBOARDING_BUILDOUT_OMIT).not.toContain('grep')
    expect(ONBOARDING_BUILDOUT_OMIT).not.toContain('find')
  })
})

describe('buildProfilingSystemPrompt', () => {
  it('includes account identity and me.md as injected assistant context', () => {
    const p = buildProfilingSystemPrompt('America/Los_Angeles', 'user@example.com')
    expect(p).toContain('user@example.com')
    expect(p).toContain('me.md')
    expect(p).toMatch(/injected/i)
    expect(p).toMatch(/AGENTS\.md/i)
    expect(p).toMatch(/read_email.*12/)
    expect(p).toMatch(/Phone numbers and iMessage identifiers/)
    expect(p).toContain(String(PROFILING_ME_MD_MAX_WORDS))
    expect(p).toMatch(/single paragraph|run-on sentence/i)
    expect(p).toMatch(/blank line.*between sections/i)
    expect(p).toContain('**people/** pages at buildout')
    expect(p).toMatch(/Anti-recency/i)
    expect(p).toMatch(/before: 90d/)
    expect(p).toMatch(/after: 3y/)
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
    expect(p).toMatch(/write.*\/.*edit.*only `me\.md` during profiling/i)
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
