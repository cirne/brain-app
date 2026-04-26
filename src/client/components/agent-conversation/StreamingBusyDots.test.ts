import { describe, it, expect } from 'vitest'
import StreamingBusyDots from './StreamingBusyDots.svelte'
import { render } from '@client/test/render.js'

describe('StreamingBusyDots.svelte', () => {
  it('renders three dots container', () => {
    const { container } = render(StreamingBusyDots)
    const root = container.querySelector('.streaming-busy-dots')
    expect(root).toBeTruthy()
    expect(root?.querySelectorAll('span')).toHaveLength(3)
    expect(root?.getAttribute('aria-hidden')).toBe('true')
  })
})
