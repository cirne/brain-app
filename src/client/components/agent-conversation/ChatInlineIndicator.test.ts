import { describe, it, expect } from 'vitest'
import { render, screen } from '@client/test/render.js'
import ChatInlineIndicatorHarness from './ChatInlineIndicatorHarness.svelte'

describe('ChatInlineIndicator.svelte', () => {
  it('renders root marker, icon slot, and label', () => {
    render(ChatInlineIndicatorHarness)

    const root = document.querySelector('[data-chat-inline-indicator]')
    expect(root).toBeTruthy()
    expect(root).toHaveClass('min-h-6')
    expect(screen.getByText('Read file')).toBeInTheDocument()
    const iconSlot = document.querySelector('.tool-transcript-icon')
    expect(iconSlot).toBeTruthy()
    expect(iconSlot?.querySelector('svg')).toBeTruthy()
  })

  it('labelOnly omits icon slot but keeps min-height band', () => {
    render(ChatInlineIndicatorHarness, { props: { labelOnly: true } })

    const root = document.querySelector('[data-chat-inline-indicator]')
    expect(root).toBeTruthy()
    expect(root).toHaveClass('min-h-6')
    expect(document.querySelector('.tool-transcript-icon')).toBeNull()
    expect(screen.getByText('Read file')).toBeInTheDocument()
  })

  it('applies error variant on root', () => {
    render(ChatInlineIndicatorHarness, { props: { variant: 'error', iconBang: true } })

    expect(document.querySelector('[data-chat-inline-indicator]')).toHaveClass('text-danger')
  })
})
