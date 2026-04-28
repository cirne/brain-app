import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

describe('UnifiedChatComposer', () => {
  it('embeds text and voice with gateable hear-replies strip', () => {
    const p = join(dirname(fileURLToPath(import.meta.url)), 'UnifiedChatComposer.svelte')
    const src = readFileSync(p, 'utf8')
    expect(src).toContain('composerMode')
    expect(src).toContain('<AgentInput')
    expect(src).toContain('<ChatVoicePanel')
    expect(src).toContain('layout="composer-flow"')
    expect(src).toContain('autoStartRecording={true}')
    expect(src).toContain('<ChatComposerAudio')
    expect(src).toContain('export function focus')
    expect(src).toContain('export function appendText')
  })
})
