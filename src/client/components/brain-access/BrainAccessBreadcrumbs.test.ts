import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import BrainAccessBreadcrumbs from './BrainAccessBreadcrumbs.svelte'

describe('BrainAccessBreadcrumbs.svelte', () => {
  it('list variant shows current page without navigation buttons', () => {
    render(BrainAccessBreadcrumbs, { props: { variant: 'list' } })
    expect(screen.getByRole('navigation', { name: /^tunnels$/i })).toBeInTheDocument()
    expect(screen.getByText('Tunnels')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('policy variant links back to tunnels list', async () => {
    const onGoToList = vi.fn()
    render(BrainAccessBreadcrumbs, {
      props: { variant: 'policy', policyLabel: 'Trusted Confidante', onGoToList },
    })
    await fireEvent.click(screen.getByRole('button', { name: /^tunnels$/i }))
    expect(onGoToList).toHaveBeenCalled()
    expect(screen.getByText('Trusted Confidante')).toBeInTheDocument()
  })
})
