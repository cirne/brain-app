import { describe, it, expect } from 'vitest'
import OnboardingLocalWikiLead from './OnboardingLocalWikiLead.svelte'
import { render, screen } from '@client/test/render.js'

describe('OnboardingLocalWikiLead.svelte', () => {
  it('renders title and lead with lock icon', () => {
    render(OnboardingLocalWikiLead, {
      props: {
        title: 'Local wiki',
        lead: 'Your notes stay on this device.',
      },
    })

    expect(screen.getByRole('heading', { name: 'Local wiki' })).toBeInTheDocument()
    expect(screen.getByText('Your notes stay on this device.')).toBeInTheDocument()
  })

  it('can hide the title', () => {
    render(OnboardingLocalWikiLead, {
      props: {
        title: 'Hidden',
        lead: 'Lead only',
        hideTitle: true,
      },
    })

    expect(screen.queryByRole('heading', { name: 'Hidden' })).not.toBeInTheDocument()
    expect(screen.getByText('Lead only')).toBeInTheDocument()
  })
})
