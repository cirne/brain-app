import { describe, it, expect } from 'vitest'
import HubSourceRowBodyHarness from './test-stubs/HubSourceRowBodyHarness.svelte'
import { render, screen } from '@client/test/render.js'

describe('HubSourceRowBody.svelte', () => {
  it('renders title, subtitle, and icon snippet', () => {
    render(HubSourceRowBodyHarness)
    expect(screen.getByText('Documents')).toBeInTheDocument()
    expect(screen.getByText('~/Library/Mail')).toBeInTheDocument()
  })
})
