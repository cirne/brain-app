import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import PolicyCard from './PolicyCard.svelte'
import { templateById } from '@client/lib/brainQueryPolicyTemplates.js'

describe('PolicyCard.svelte', () => {
  it('renders policy label and navigates to detail when the card is activated', async () => {
    const onSettingsNavigate = vi.fn()
    const tpl = templateById('trusted')!
    render(PolicyCard, {
      props: {
        model: {
          policyId: tpl.id,
          kind: 'builtin',
          builtinId: tpl.id,
          label: tpl.label,
          hint: tpl.hint,
          canonicalText: tpl.text,
          grants: [],
        },
        policyActivityCount: 0,
        onSettingsNavigate,
        onAddUser: vi.fn(),
        onRemoveGrant: vi.fn(),
        onOpenChangePolicy: vi.fn(),
      },
    })
    expect(screen.getByText(new RegExp(tpl.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('link', { name: /open policy/i }))
    expect(onSettingsNavigate).toHaveBeenCalledWith({ type: 'brain-access-policy', policyId: tpl.id })
  })
})
