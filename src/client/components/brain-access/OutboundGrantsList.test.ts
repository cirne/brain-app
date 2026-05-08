import { describe, expect, it } from 'vitest'
import { render, screen } from '@client/test/render.js'
import OutboundGrantsList from './OutboundGrantsList.svelte'
import { templateById } from '@client/lib/brainQueryPolicyTemplates.js'

describe('OutboundGrantsList.svelte', () => {
  it('shows policy pill per outbound grant without collapse', () => {
    const tpl = templateById('trusted')!
    render(OutboundGrantsList, {
      props: {
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
      },
    })
    expect(screen.getByRole('heading', { name: /^brains you can ask$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^brains you can ask$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/tap to expand/i)).not.toBeInTheDocument()
    expect(screen.getByText(`@${'them-brain'}`)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(tpl.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))).toBeInTheDocument()
  })

  it('shows empty copy when nothing granted to me', () => {
    render(OutboundGrantsList, {
      props: {
        grantedToMe: [],
        customPolicies: [],
      },
    })
    expect(screen.getByText(/no access yet/i)).toBeInTheDocument()
  })
})
