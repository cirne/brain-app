import { describe, it, expect, vi, beforeEach } from 'vitest'
import HearRepliesControl from './HearRepliesControl.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'
import { ensureBrainTtsAutoplayInUserGesture } from '@client/lib/brainTtsAudio.js'

vi.mock('@client/lib/brainTtsAudio.js', () => ({
  ensureBrainTtsAutoplayInUserGesture: vi.fn().mockResolvedValue(undefined),
}))

const mockedTts = vi.mocked(ensureBrainTtsAutoplayInUserGesture)

describe('HearRepliesControl.svelte', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Audio Conversation label', () => {
    render(HearRepliesControl, { props: {} })
    expect(screen.getByText('Audio Conversation')).toBeInTheDocument()
  })

  it('calls onHearRepliesChange and unlocks TTS autoplay when enabling (no mic permission)', async () => {
    const onHearRepliesChange = vi.fn()
    render(HearRepliesControl, {
      props: { hearReplies: false, onHearRepliesChange },
    })

    const cb = screen.getByRole('checkbox', { name: /audio conversation/i })
    await fireEvent.click(cb)

    expect(onHearRepliesChange).toHaveBeenCalledWith(true)
    expect(mockedTts).toHaveBeenCalledTimes(1)
  })
})
