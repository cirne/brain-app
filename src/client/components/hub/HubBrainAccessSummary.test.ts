import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import HubBrainAccessSummary from './HubBrainAccessSummary.svelte'

describe('HubBrainAccessSummary.svelte', () => {
  it('calls onManageAccess when primary row clicked', async () => {
    const onManageAccess = vi.fn()
    render(HubBrainAccessSummary, { props: { onManageAccess } })
    await fireEvent.click(screen.getByRole('button', { name: /manage brain access/i }))
    expect(onManageAccess).toHaveBeenCalledTimes(1)
  })

  it('exposes stable hub-sharing anchor id for deep links', () => {
    render(HubBrainAccessSummary, { props: { onManageAccess: vi.fn() } })
    expect(document.getElementById('hub-sharing')).toBeTruthy()
  })
})
