import { describe, it, expect } from 'vitest'
import FeedbackDraftPreviewCard from './FeedbackDraftPreviewCard.svelte'
import { render, screen } from '@client/test/render.js'

describe('FeedbackDraftPreviewCard.svelte', () => {
  it('renders markdown in a labelled region', () => {
    render(FeedbackDraftPreviewCard, {
      props: { markdown: '# Issue title\n\nSome **body**.' },
    })
    expect(screen.getByRole('region', { name: /feedback draft/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: /issue title/i })).toBeInTheDocument()
  })
})
