import { describe, it, expect, vi, beforeEach } from 'vitest'
import BrainTunnelBrandToggle from './BrainTunnelBrandToggle.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('BrainTunnelBrandToggle.svelte', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders icon + Braintunnel and invokes onclick', async () => {
    const onclick = vi.fn()
    render(BrainTunnelBrandToggle, {
      props: {
        onclick,
        ariaLabel: 'Open navigation',
      },
    })

    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveTextContent('Braintunnel')
    await fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(onclick).toHaveBeenCalledTimes(1)
  })

  it('can omit the wordmark while keeping icon button behavior', async () => {
    const onclick = vi.fn()
    render(BrainTunnelBrandToggle, {
      props: {
        onclick,
        showTitle: false,
        ariaLabel: 'Open navigation',
      },
    })

    const btn = screen.getByRole('button', { name: 'Open navigation' })
    expect(btn).not.toHaveTextContent('Braintunnel')
    await fireEvent.click(btn)
    expect(onclick).toHaveBeenCalledTimes(1)
  })
})
