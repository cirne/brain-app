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
    expect(src).toContain('chat.voice.toolbarAria')
    expect(src).toContain('chat-voice-panel')
    expect(src).toContain('chat-voice-panel--fixed')
    expect(src).toContain('chat-voice-panel--inline')
    expect(src).toContain('chat-voice-panel--composer-flow')
    /* Composer-flow: inner row is flex-row alongside voice-actions :global overrides */
    expect(src).toContain('chat-voice-panel-inner')
    expect(src).toContain('input-composer flex min-h-[48px]')
    expect(src).toContain('send-actions flex shrink-0 flex-row items-stretch self-stretch')
    expect(src).toContain('voice-exit-keyboard')
    expect(src).toContain('lead-actions flex shrink-0 flex-row items-stretch self-stretch')
    expect(src).toContain('autoStartRecording')
    expect(src).toContain('chat.voice.transcribing')

    expect(readFileSync(primary, 'utf8')).toContain('voice-pulse-ring')
    expect(readFileSync(primary, 'utf8')).toContain('ArrowUp')
    expect(readFileSync(waveform, 'utf8')).toContain('voice-waveform')
    expect(src).toContain('RecordingWaveformIndicator')
    expect(readFileSync(actions, 'utf8')).toContain('chat.voice.restartRecordingAria')
    expect(readFileSync(actions, 'utf8')).toContain('chat.voice.cancelRecordingAria')
  })
})
