import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { createAgentTools } from './tools.js'
import { B2B_QUERY_ONLY } from './agentToolSets.js'
import { buildB2BFilterPrompt, buildB2BResearchPrompt, createB2BToolOptions } from './b2bAgent.js'

ensurePromptsRoot(fileURLToPath(new URL('../prompts', import.meta.url)))

function toolNamesForB2B(wikiRoot: string): string[] {
  return createAgentTools(wikiRoot, createB2BToolOptions('America/Chicago'))
    .map(t => (t as { name?: string }).name)
    .filter((name): name is string => typeof name === 'string')
}

describe('b2bAgent', () => {
  it('uses a restricted read-only tool allowlist', async () => {
    const wikiRoot = await mkdtemp(join(tmpdir(), 'b2b-agent-tools-'))
    try {
      const names = toolNamesForB2B(wikiRoot)
      expect(names).toEqual(expect.arrayContaining([...B2B_QUERY_ONLY]))
      expect(names).not.toEqual(expect.arrayContaining(['write', 'edit', 'draft_email', 'send_draft', 'ask_collaborator']))
    } finally {
      await rm(wikiRoot, { recursive: true, force: true })
    }
  })

  it('builds a research prompt with owner profile and grant policy', async () => {
    const wikiRoot = await mkdtemp(join(tmpdir(), 'b2b-agent-prompt-'))
    try {
      await writeFile(join(wikiRoot, 'me.md'), 'Ken Lay prefers concise leadership updates.\n', 'utf-8')
      const prompt = buildB2BResearchPrompt({
        ownerDisplayName: 'Kenneth Lay',
        privacyPolicy: 'Do not reveal financial details.',
        wikiRoot,
        timezone: 'America/Chicago',
        promptClock: { tenantUserId: null },
      })
      expect(prompt).toContain('Kenneth Lay')
      expect(prompt).toContain('Do not reveal financial details.')
      expect(prompt).toContain('Ken Lay prefers concise leadership updates.')
      expect(prompt).toContain('Do not expose tool calls')
    } finally {
      await rm(wikiRoot, { recursive: true, force: true })
    }
  })

  it('builds a filter prompt around the policy and draft answer', () => {
    const prompt = buildB2BFilterPrompt({
      privacyPolicy: 'No message ids.',
      draftAnswer: 'Here is JavaMail.evans@thyme from a tool result.',
    })
    expect(prompt).toContain('No message ids.')
    expect(prompt).toContain('JavaMail.evans@thyme')
    expect(prompt).toContain('Remove raw tool details')
  })
})
