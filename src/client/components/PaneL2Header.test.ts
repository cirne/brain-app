import { describe, it, expect } from 'vitest'
import PaneL2HeaderHarness from './test-stubs/PaneL2HeaderHarness.svelte'
import { render, screen } from '@client/test/render.js'

describe('PaneL2Header.svelte', () => {
  it('renders left, center, and right snippet slots', () => {
    render(PaneL2HeaderHarness)

    expect(screen.getByTestId('pane-left')).toHaveTextContent('Left')
    expect(screen.getByTestId('pane-center')).toHaveTextContent('Center')
    expect(screen.getByTestId('pane-right')).toHaveTextContent('Right')
  })

  it('uses a header landmark', () => {
    const { container } = render(PaneL2HeaderHarness)
    expect(container.querySelector('header.pane-l2-header')).toBeTruthy()
  })
})
