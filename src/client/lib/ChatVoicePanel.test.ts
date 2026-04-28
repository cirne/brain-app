import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

describe('ChatVoicePanel', () => {
  it('implements OPP-055 tap-to-talk toolbar and capture wiring', () => {
    const panel = join(
      dirname(fileURLToPath(import.meta.url)),
      '../components/ChatVoicePanel.svelte',
    )
    const primary = join(
      dirname(fileURLToPath(import.meta.url)),
      '../components/VoicePrimaryButton.svelte',
    )
    const actions = join(
      dirname(fileURLToPath(import.meta.url)),
      '../components/VoiceActionButtons.svelte',
    )
    const waveform = join(
      dirname(fileURLToPath(import.meta.url)),
      '../components/RecordingWaveformIndicator.svelte',
    )
    const src = readFileSync(panel, 'utf8')
    expect(src).toContain('VoiceTapRecorder')
    expect(src).toContain('role="toolbar"')
    expect(src).toContain('Voice input')
    expect(src).toContain('chat-voice-panel')
    expect(src).toContain('chat-voice-panel--fixed')
    expect(src).toContain('chat-voice-panel--inline')
    expect(src).toContain('chat-voice-panel--composer-flow')
    expect(src).toContain('flex-direction: row-reverse')
    expect(src).toContain('voice-waveform-placeholder')
    expect(src).toContain('voice-exit-keyboard')
    expect(src).toContain('autoStartRecording')
    expect(src).toContain('Transcribing')

    expect(readFileSync(primary, 'utf8')).toContain('voice-pulse-ring')
    expect(readFileSync(primary, 'utf8')).toContain('ArrowUp')
    expect(readFileSync(waveform, 'utf8')).toContain('voice-waveform')
    expect(src).toContain('RecordingWaveformIndicator')
    expect(readFileSync(actions, 'utf8')).toContain('Restart recording')
    expect(readFileSync(actions, 'utf8')).toContain('Cancel recording')
  })
})
