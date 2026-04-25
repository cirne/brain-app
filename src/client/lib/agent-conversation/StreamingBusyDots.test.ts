import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

describe('StreamingBusyDots', () => {
  it('is the shared animated in-flight indicator (no "Thinking" copy)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const ac = join(here, '../../components/agent-conversation')
    const dots = readFileSync(join(ac, 'StreamingBusyDots.svelte'), 'utf8')
    const agent = readFileSync(join(here, '../../components/AgentChat.svelte'), 'utf8')
    const row = readFileSync(join(ac, 'ChatMessageRow.svelte'), 'utf8')
    expect(dots).toContain('streaming-busy-dots')
    expect(agent).not.toContain('StreamingBusyDots')
    expect(row).toContain('StreamingBusyDots')
    expect(agent).toContain("(chatTitle ?? '').trim() || headerFallbackTitle")
    expect(agent).toContain("streamingBusyLabel = ''")
    expect(agent).not.toContain("streamingBusyLabel = 'Thinking...'")
  })
})
