import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

describe('StreamingBusyDots', () => {
  it('is the shared animated in-flight indicator (no "Thinking" copy)', () => {
    const root = dirname(fileURLToPath(import.meta.url))
    const dots = readFileSync(join(root, 'StreamingBusyDots.svelte'), 'utf8')
    const agent = readFileSync(join(dirname(root), 'AgentChat.svelte'), 'utf8')
    const row = readFileSync(join(root, 'ChatMessageRow.svelte'), 'utf8')
    expect(dots).toContain('streaming-busy-dots')
    expect(agent).not.toContain('StreamingBusyDots')
    expect(row).toContain('StreamingBusyDots')
    expect(agent).toContain("(chatTitle ?? '').trim() || headerFallbackTitle")
    expect(agent).toContain("streamingBusyLabel = ''")
    expect(agent).not.toContain("streamingBusyLabel = 'Thinking...'")
  })
})
