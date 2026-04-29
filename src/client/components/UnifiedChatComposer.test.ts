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

  it('wiki primary dock in Assistant passes transparent surround (no grey .input-area bar)', () => {
    const p = join(dirname(fileURLToPath(import.meta.url)), 'Assistant.svelte')
    const src = readFileSync(p, 'utf8')
    const i = src.indexOf('wiki-primary-composer-stack')
    expect(i).toBeGreaterThan(-1)
    expect(src.slice(i, i + 1200)).toContain('transparentSurround={true}')
  })

  it('wiki primary composer dock has no top border (flush with content above)', () => {
    const p = join(dirname(fileURLToPath(import.meta.url)), 'Assistant.svelte')
    const src = readFileSync(p, 'utf8')
    const m = src.match(/\.wiki-primary-composer-dock\s*\{[^}]*\}/)
    expect(m).toBeTruthy()
    expect(m![0]).not.toContain('border-top')
  })
})
