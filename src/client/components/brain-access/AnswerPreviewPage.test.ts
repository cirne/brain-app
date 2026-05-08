import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@client/test/render.js'
import AnswerPreviewPage from './AnswerPreviewPage.svelte'
import { BRAIN_QUERY_POLICY_TEMPLATES } from '@client/lib/brainQueryPolicyTemplates.js'

vi.mock('@client/lib/vaultClient.js', () => ({
  fetchVaultStatus: vi.fn(() =>
    Promise.resolve({
      unlocked: true,
      multiTenant: false,
    }),
  ),
}))

function reqUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

describe('AnswerPreviewPage.svelte', () => {
  const trustedBody = BRAIN_QUERY_POLICY_TEMPLATES[0]!.text
  const trustedGrant = {
    id: 'g1',
    ownerId: 'o1',
    ownerHandle: 'me',
    askerId: 'a1',
    askerHandle: 'coleague',
    privacyPolicy: trustedBody,
    createdAtMs: 1,
    updatedAtMs: 1,
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const u = reqUrl(input)
        if (u.includes('/api/brain-query/grants') && (!init?.method || init.method === 'GET')) {
          return Promise.resolve(new Response(JSON.stringify({ grantedByMe: [trustedGrant] }), { status: 200 }))
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as typeof fetch,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders title and inbound-activity disclaimer', async () => {
    const onBackToBrainAccessList = vi.fn()
    const onBackToPolicy = vi.fn()
    render(AnswerPreviewPage, {
      props: {
        policyId: 'trusted',
        onBackToBrainAccessList,
        onBackToPolicy,
      },
    })

    await waitFor(() => expect(screen.getByRole('heading', { name: /test policy responses/i })).toBeInTheDocument())
    expect(screen.getByText(/Previews aren’t saved to inbound activity/)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /brain access/i })).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText(/Ask something a collaborator might ask about your vault or mail\./),
    ).toBeInTheDocument()
  })
})
