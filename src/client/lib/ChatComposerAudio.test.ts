import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Mobile hear-replies strip; tap-to-talk lives in {@link ChatVoicePanel} (OPP-055).
 */
describe('ChatComposerAudio', () => {
  it('does not embed hold-to-speak or draft-hiding (tap panel replaces it)', () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      '../components/ChatComposerAudio.svelte',
    )
    const src = readFileSync(path, 'utf8')
    expect(src).not.toContain('AgentHoldToSpeak')
    expect(src).not.toContain('draftHidesHold')
    expect(src).not.toContain('hold-speak-wrap')
  })

  it('only mounts the mobile strip when the hear-replies toggle is shown (no empty PTT shell)', () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      '../components/ChatComposerAudio.svelte',
    )
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('isMobile && showHearRepliesToggle')
    expect(src).not.toContain('isPressToTalkEnabled')
  })
})
