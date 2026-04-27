import { describe, it, expect, vi, beforeEach } from 'vitest'
import HearRepliesControl from './HearRepliesControl.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'
import { requestMicrophonePermissionInUserGesture } from '@client/lib/holdToSpeakMedia.js'

vi.mock('@client/lib/brainTtsAudio.js', () => ({
  ensureBrainTtsAutoplayInUserGesture: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@client/lib/holdToSpeakMedia.js', () => ({
  requestMicrophonePermissionInUserGesture: vi.fn(),
}))

const isPressToTalkEnabledMock = vi.hoisted(() => vi.fn(() => false))
vi.mock('@client/lib/pressToTalkEnabled.js', () => ({
  isPressToTalkEnabled: isPressToTalkEnabledMock,
}))

const mockedRequestMic = vi.mocked(requestMicrophonePermissionInUserGesture)

describe('HearRepliesControl.svelte', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isPressToTalkEnabledMock.mockReturnValue(false)
  })

  it('renders Audio Conversation label', () => {
    render(HearRepliesControl, { props: {} })
    expect(screen.getByText('Audio Conversation')).toBeInTheDocument()
  })

  it('calls onHearRepliesChange when toggled', async () => {
    const onHearRepliesChange = vi.fn()
    isPressToTalkEnabledMock.mockReturnValue(false)
    render(HearRepliesControl, {
      props: { hearReplies: false, onHearRepliesChange },
    })

    const cb = screen.getByRole('checkbox', { name: /audio conversation/i })
    await fireEvent.click(cb)

    expect(onHearRepliesChange).toHaveBeenCalledWith(true)
    expect(mockedRequestMic).not.toHaveBeenCalled()
  })

  it('requests microphone in the same gesture when press-to-talk is enabled', async () => {
    isPressToTalkEnabledMock.mockReturnValue(true)
    const onHearRepliesChange = vi.fn()
    render(HearRepliesControl, {
      props: { hearReplies: false, onHearRepliesChange },
    })

    const cb = screen.getByRole('checkbox', { name: /audio conversation/i })
    await fireEvent.click(cb)

    expect(mockedRequestMic).toHaveBeenCalledTimes(1)
  })
})
