import { describe, it, expect } from 'vitest'
import { render, screen } from '@client/test/render.js'
import ChatInlineIndicatorHarness from './ChatInlineIndicatorHarness.svelte'

describe('ChatInlineIndicator.svelte', () => {
  it('renders root marker, icon slot, and label inside tool-call-row', () => {
    render(ChatInlineIndicatorHarness)

    expect(document.querySelector('.tool-call-row')).toBeTruthy()
    const root = document.querySelector('[data-chat-inline-indicator]')
    expect(root).toBeTruthy()
    expect(screen.getByText('Read file')).toBeInTheDocument()
    const iconSlot = document.querySelector('.tool-transcript-icon')
    expect(iconSlot).toBeTruthy()
    expect(iconSlot?.querySelector('svg')).toBeTruthy()
  })

  it('labelOnly omits icon slot', () => {
    render(ChatInlineIndicatorHarness, { props: { labelOnly: true } })

    expect(document.querySelector('.tool-transcript-icon')).toBeNull()
    expect(screen.getByText('Read file')).toBeInTheDocument()
  })

  it('applies error variant on root', () => {
    render(ChatInlineIndicatorHarness, { props: { variant: 'error', iconBang: true } })

    expect(document.querySelector('[data-chat-inline-indicator]')).toHaveClass('text-danger')
  })
})
