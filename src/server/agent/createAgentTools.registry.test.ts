import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_AGENT_TOOL_NAMES } from './agentToolSets.js'
import { createAgentTools } from './tools.js'

function namedTools(tools: { name?: string }[]): string[] {
  return tools.map((t) => t.name).filter((n): n is string => typeof n === 'string')
}

const LOCAL_OPTIONAL: readonly (typeof ALL_AGENT_TOOL_NAMES)[number][] = [
  'list_recent_messages',
  'get_message_thread',
]

describe('createAgentTools registry vs ALL_AGENT_TOOL_NAMES', () => {
  it('with includeLocalMessageTools true, every catalog name is registered exactly once', async () => {
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
})
