import { describe, it, expect } from 'vitest'
import FindPersonHitsPreviewCard from './FindPersonHitsPreviewCard.svelte'
import { render, screen } from '@client/test/render.js'

describe('FindPersonHitsPreviewCard.svelte', () => {
  it('shows empty copy when there are no people', () => {
    render(FindPersonHitsPreviewCard, {
      props: { queryLine: 'alice', people: [] },
    })
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText(/no contacts in result/i)).toBeInTheDocument()
  })

  it('renders names and optional emails', () => {
    render(FindPersonHitsPreviewCard, {
      props: {
        queryLine: 'q',
        people: [
          { name: 'Pat Lee', email: 'pat@example.com' },
          { name: 'Sam' },
        ],
      },
    })
    expect(screen.getByText('Pat Lee')).toBeInTheDocument()
    expect(screen.getByText('pat@example.com')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
  })
})
