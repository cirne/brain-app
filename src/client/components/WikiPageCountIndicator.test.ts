import { describe, it, expect } from 'vitest'
import WikiPageCountIndicator from './WikiPageCountIndicator.svelte'
import { render, screen } from '@client/test/render.js'

describe('WikiPageCountIndicator.svelte', () => {
  it('shows count and singular label for 1', () => {
    render(WikiPageCountIndicator, { props: { count: 1 } })
    expect(screen.getByRole('img', { name: /1 page in wiki/i })).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('shows plural label for multiple pages', () => {
    render(WikiPageCountIndicator, { props: { count: 42 } })
    expect(screen.getByRole('img', { name: /42 pages in wiki/i })).toBeInTheDocument()
  })

  it('shows loading label when count is null', () => {
    render(WikiPageCountIndicator, { props: { count: null } })
    expect(screen.getByRole('img', { name: /wiki page count loading/i })).toBeInTheDocument()
  })

  it('includes background activity in aria-label when pulsing', () => {
    render(WikiPageCountIndicator, {
      props: { count: 3, showPulse: true, pulseAnimating: true },
    })
    expect(
      screen.getByRole('img', { name: /3 pages in wiki, background activity/i }),
    ).toBeInTheDocument()
  })

  it('applies large size class', () => {
    const { container } = render(WikiPageCountIndicator, {
      props: { count: 0, size: 'lg' },
    })
    expect(container.querySelector('.wiki-page-count-indicator--lg')).toBeTruthy()
  })
})
