import { describe, it, expect } from 'vitest'
import HubSourceRowBodyHarness from './test-stubs/HubSourceRowBodyHarness.svelte'
import HubSourceRowBody from './HubSourceRowBody.svelte'
import { render, screen } from '@client/test/render.js'

describe('HubSourceRowBody.svelte', () => {
  it('renders title, subtitle, and icon snippet', () => {
    render(HubSourceRowBodyHarness)
    expect(screen.getByText('Documents')).toBeInTheDocument()
    expect(screen.getByText('~/Library/Mail')).toBeInTheDocument()
  })

  it('renders without a leading icon when icon snippet is omitted', () => {
    render(HubSourceRowBody, {
      props: {
        title: 'Label only',
        subtitle: 'Second line',
      },
    })
    expect(screen.getByText('Label only')).toBeInTheDocument()
    expect(screen.getByText('Second line')).toBeInTheDocument()
    expect(document.querySelector('.hub-source-icon-wrap')).not.toBeInTheDocument()
  })
})
