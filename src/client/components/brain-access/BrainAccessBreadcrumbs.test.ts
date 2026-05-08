import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import BrainAccessBreadcrumbs from './BrainAccessBreadcrumbs.svelte'

describe('BrainAccessBreadcrumbs.svelte', () => {
  it('list variant shows current page without navigation buttons', () => {
    render(BrainAccessBreadcrumbs, { props: { variant: 'list' } })
    expect(screen.getByRole('navigation', { name: /brain access/i })).toBeInTheDocument()
    expect(screen.getByText('Brain to Brain access')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('policy variant links back to brain access list', async () => {
    const onGoToList = vi.fn()
    render(BrainAccessBreadcrumbs, {
      props: { variant: 'policy', policyLabel: 'Trusted Confidante', onGoToList },
    })
    await fireEvent.click(screen.getByRole('button', { name: /^brain to brain access$/i }))
    expect(onGoToList).toHaveBeenCalled()
    expect(screen.getByText('Trusted Confidante')).toBeInTheDocument()
  })

  it('preview variant links list and policy', async () => {
    const onGoToList = vi.fn()
    const onGoToPolicy = vi.fn()
    render(BrainAccessBreadcrumbs, {
      props: {
        variant: 'preview',
        policyLabel: 'Trusted Confidante',
        onGoToList,
        onGoToPolicy,
      },
    })
    await fireEvent.click(screen.getByRole('button', { name: /^brain to brain access$/i }))
    expect(onGoToList).toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: /^trusted confidante$/i }))
    expect(onGoToPolicy).toHaveBeenCalled()
    expect(screen.getByText('Test policy')).toBeInTheDocument()
  })
})
