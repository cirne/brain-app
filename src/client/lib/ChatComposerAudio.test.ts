import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Regression: mobile + audio hold-to-speak gives space back to the composer when the user types
 * (draft-driven collapse + flex gap cleanup).
 */
describe('ChatComposerAudio', () => {
  it('collapses the hold control when draftHidesHold is set', () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), 'ChatComposerAudio.svelte')
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('draftHidesHold')
    expect(src).toContain('hold-speak-wrap--draft-slid')
    expect(src).toContain('chat-composer-audio--hold-slid')
  })
})
