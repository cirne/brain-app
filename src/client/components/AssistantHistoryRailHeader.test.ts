import { describe, it, expect, vi, beforeEach } from 'vitest'
import AssistantHistoryRailHeader from './AssistantHistoryRailHeader.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('AssistantHistoryRailHeader.svelte', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders product name and two close targets (✕ control + clickable brand)', () => {
    const onClose = vi.fn()
    render(AssistantHistoryRailHeader, { props: { onClose } })

    expect(screen.getByText('Braintunnel')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Close sidebar' })).toHaveLength(2)
  })

  it('calls onClose from the ✕ button or the brand control', async () => {
    const onClose = vi.fn()
    render(AssistantHistoryRailHeader, { props: { onClose } })

    const closeTargets = screen.getAllByRole('button', { name: 'Close sidebar' })
    await fireEvent.click(closeTargets[1])
    await fireEvent.click(closeTargets[0])
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
