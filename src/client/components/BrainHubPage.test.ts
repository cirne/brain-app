import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@client/test/render.js'
import BrainHubPage from './BrainHubPage.svelte'

vi.mock('@client/lib/vaultClient.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/vaultClient.js')>()
  return {
    ...mod,
    fetchVaultStatus: vi.fn(() =>
      Promise.resolve({
        vaultExists: true,
        unlocked: true,
        multiTenant: true,
        handleConfirmed: true,
        workspaceHandle: 'testuser',
      }),
    ),
  }
})

vi.mock('@client/lib/app/appEvents.js', () => ({
  subscribe: vi.fn(() => () => {}),
}))

vi.mock('@client/lib/hubEvents/hubEventsStores.js', () => ({
  yourWikiDocFromEvents: { subscribe: vi.fn(() => () => {}) },
}))

describe('BrainHubPage.svelte', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo) => {
        const u = String(url)
        if (u.includes('/api/wiki/edit-history')) {
          return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }))
        }
        if (u.includes('/api/wiki/recent')) {
          return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }))
        }
        if (u.includes('/api/wiki') && !u.includes('edit-history') && !u.includes('recent')) {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        if (u.includes('/api/onboarding/mail')) {
          return Promise.resolve(
            new Response(JSON.stringify({ indexedTotal: 0, configured: false }), { status: 200 }),
          )
        }
        if (u.includes('/api/hub/sources')) {
          return Promise.resolve(new Response(JSON.stringify({ sources: [] }), { status: 200 }))
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows hosted workspace handle under the page title', async () => {
    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })

    expect(screen.getByRole('heading', { level: 1, name: /braintunnel hub/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('@testuser')).toBeInTheDocument()
    })
  })
})
