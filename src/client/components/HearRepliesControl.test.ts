import { describe, it, expect, vi, beforeEach } from 'vitest'
import HearRepliesControl from './HearRepliesControl.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

vi.mock('@client/lib/brainTtsAudio.js', () => ({
  ensureBrainTtsAutoplayInUserGesture: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@client/lib/holdToSpeakMedia.js', () => ({
  requestMicrophonePermissionInUserGesture: vi.fn(),
}))

describe('HearRepliesControl.svelte', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Audio Conversation label', () => {
    render(HearRepliesControl, { props: {} })
    expect(screen.getByText('Audio Conversation')).toBeInTheDocument()
  })

  it('calls onHearRepliesChange when toggled', async () => {
    const onHearRepliesChange = vi.fn()
    render(HearRepliesControl, {
      props: { hearReplies: false, onHearRepliesChange },
    })

    const cb = screen.getByRole('checkbox', { name: /audio conversation/i })
    await fireEvent.click(cb)

    expect(onHearRepliesChange).toHaveBeenCalledWith(true)
  })
})
