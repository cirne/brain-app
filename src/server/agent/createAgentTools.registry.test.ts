import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_AGENT_TOOL_NAMES } from './agentToolSets.js'

function namedTools(tools: { name?: string }[]): string[] {
  return tools.map((t) => t.name).filter((n): n is string => typeof n === 'string')
}

const LOCAL_OPTIONAL: readonly (typeof ALL_AGENT_TOOL_NAMES)[number][] = [
  'list_recent_messages',
  'get_message_thread',
]

describe('createAgentTools registry vs ALL_AGENT_TOOL_NAMES', () => {
  const prevB2b = process.env.BRAIN_B2B_ENABLED

  beforeEach(() => {
    process.env.BRAIN_B2B_ENABLED = '1'
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetModules()
    if (prevB2b === undefined) delete process.env.BRAIN_B2B_ENABLED
    else process.env.BRAIN_B2B_ENABLED = prevB2b
  })

  it('with includeLocalMessageTools true, every catalog name is registered exactly once', async () => {
    const { createAgentTools } = await import('./tools.js')
    const dir = await mkdtemp(join(tmpdir(), 'brain-agent-tools-'))
    await writeFile(join(dir, 'stub.md'), '# stub\n', 'utf-8')
    const tools = createAgentTools(dir, { includeLocalMessageTools: true })
    const names = namedTools(tools)
    const set = new Set(names)
    expect(set.size).toBe(names.length)
    for (const n of ALL_AGENT_TOOL_NAMES) {
      expect(set.has(n)).toBe(true)
    }
    for (const n of names) {
      expect((ALL_AGENT_TOOL_NAMES as readonly string[]).includes(n)).toBe(true)
    }
  })

  it('with includeLocalMessageTools false, omits only local message thread tools', async () => {
    const { createAgentTools } = await import('./tools.js')
    const dir = await mkdtemp(join(tmpdir(), 'brain-agent-tools-'))
    await writeFile(join(dir, 'stub.md'), '# stub\n', 'utf-8')
    const tools = createAgentTools(dir, { includeLocalMessageTools: false })
    const set = new Set(namedTools(tools))
    for (const n of LOCAL_OPTIONAL) {
      expect(set.has(n)).toBe(false)
    }
    for (const n of ALL_AGENT_TOOL_NAMES) {
      if (!LOCAL_OPTIONAL.includes(n)) {
        expect(set.has(n)).toBe(true)
      }
    }
  })

  it('omits ask_collaborator when BRAIN_B2B_ENABLED is off', async () => {
    process.env.BRAIN_B2B_ENABLED = '0'
    vi.resetModules()
    const { createAgentTools } = await import('./tools.js')
    const dir = await mkdtemp(join(tmpdir(), 'brain-agent-tools-b2boff-'))
    await writeFile(join(dir, 'stub.md'), '# stub\n', 'utf-8')
    const tools = createAgentTools(dir, { includeLocalMessageTools: true })
    expect(namedTools(tools).includes('ask_collaborator')).toBe(false)
  })
})
