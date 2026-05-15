import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import { translateClient } from '@client/lib/i18n/index.js'
import OutboundGrantsList from './OutboundGrantsList.svelte'
import { getBuiltinPolicyBodiesFromDisk } from '@server/lib/brainQuery/builtinPolicyBodiesFromDisk.js'
import { templateById } from '@client/lib/brainQueryPolicyTemplates.js'

describe('OutboundGrantsList.svelte', () => {
  const builtinPolicyBodies = getBuiltinPolicyBodiesFromDisk()
  const tpl = templateById(builtinPolicyBodies, 'trusted')!

  it('shows policy pill per outbound grant without collapse', () => {
    render(OutboundGrantsList, {
      props: {
        builtinPolicyBodies,
        grantedToMe: [
          {
            id: 'g1',
            ownerId: 'usr_owner111111111111',
            ownerHandle: 'them-brain',
            askerId: 'usr_me0000000000000001',
            privacyPolicy: tpl.text,
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ],
        customPolicies: [],
        onRemoveInbound: vi.fn(),
      },
    })
    expect(screen.getByRole('heading', { name: /^brains you can message$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^brains you can message$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/tap to expand/i)).not.toBeInTheDocument()
    expect(screen.getByText(`@${'them-brain'}`)).toBeInTheDocument()
    const resolvedLabel = translateClient(tpl.labelKey)
    expect(screen.getByText(new RegExp(resolvedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))).toBeInTheDocument()
  })

  it('remove control calls onRemoveInbound with grant id', async () => {
    const onRemoveInbound = vi.fn()
    render(OutboundGrantsList, {
      props: {
        builtinPolicyBodies,
        grantedToMe: [
          {
            id: 'grant-in-1',
            ownerId: 'usr_owner111111111111',
            ownerHandle: 'peer-handle',
            askerId: 'usr_me',
            privacyPolicy: tpl.text,
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ],
        customPolicies: [],
        onRemoveInbound,
      },
    })
    const remove = screen.getByRole('button', { name: /remove access to @peer-handle/i })
    await fireEvent.click(remove)
    expect(onRemoveInbound).toHaveBeenCalledWith('grant-in-1')
  })

  it('shows empty copy when nothing granted to me', () => {
    render(OutboundGrantsList, {
      props: {
        builtinPolicyBodies,
        grantedToMe: [],
        customPolicies: [],
      },
    })
    expect(screen.getByText(/no one here yet/i)).toBeInTheDocument()
  })
})
