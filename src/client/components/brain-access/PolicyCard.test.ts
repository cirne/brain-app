import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import { translateClient } from '@client/lib/i18n/index.js'
import PolicyCard from './PolicyCard.svelte'
import { getBuiltinPolicyBodiesFromDisk } from '@server/lib/brainQuery/builtinPolicyBodiesFromDisk.js'
import { templateById } from '@client/lib/brainQueryPolicyTemplates.js'

describe('PolicyCard.svelte', () => {
  it('renders policy label and navigates to detail when the card is activated', async () => {
    const onSettingsNavigate = vi.fn()
    const bodies = getBuiltinPolicyBodiesFromDisk()
    const tpl = templateById(bodies, 'trusted')!
    const resolvedLabel = translateClient(tpl.labelKey)
    const resolvedHint = translateClient(tpl.hintKey)
    render(PolicyCard, {
      props: {
        model: {
          policyId: tpl.id,
          kind: 'builtin',
          builtinId: tpl.id,
          label: resolvedLabel,
          hint: resolvedHint,
          canonicalText: tpl.text,
          grants: [],
        },
        onSettingsNavigate,
        onAddUser: vi.fn(),
        onRemoveGrant: vi.fn(),
        onOpenChangePolicy: vi.fn(),
      },
    })
    expect(screen.getByText(new RegExp(resolvedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('link', { name: /open policy/i }))
    expect(onSettingsNavigate).toHaveBeenCalledWith({ type: 'brain-access-policy', policyId: tpl.id })
  })

  it('select variant calls onSelect when a different preset is chosen', async () => {
    const onSelect = vi.fn()
    const bodies = getBuiltinPolicyBodiesFromDisk()
    const tpl = templateById(bodies, 'trusted')!
    render(PolicyCard, {
      props: {
        variant: 'select',
        model: {
          policyId: tpl.id,
          kind: 'builtin',
          builtinId: tpl.id,
          label: translateClient(tpl.labelKey),
          hint: translateClient(tpl.hintKey),
          canonicalText: tpl.text,
          grants: [],
        },
        radioName: 'test-policy',
        selected: false,
        onSelect,
      },
    })
    const radio = screen.getByRole('radio', { name: new RegExp(translateClient(tpl.labelKey), 'i') })
    await fireEvent.click(radio)
    expect(onSelect).toHaveBeenCalledWith('trusted')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
