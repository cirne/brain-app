import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import BrainAccessPage from './BrainAccessPage.svelte'

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

describe('BrainAccessPage.svelte', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const u = reqUrl(input)
        if (u.includes('/api/brain-query/policies')) {
          return Promise.resolve(new Response(JSON.stringify({ policies: [] }), { status: 200 }))
        }
        if (u.includes('/api/brain-query/grants')) {
          return Promise.resolve(
            new Response(JSON.stringify({ grantedByMe: [], grantedToMe: [] }), { status: 200 }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as typeof fetch,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders heading and policy buckets', async () => {
    const onSettingsNavigate = vi.fn()
    const onBackToSettingsMain = vi.fn()
    render(BrainAccessPage, {
      props: { onSettingsNavigate, onBackToSettingsMain },
    })
    expect(screen.getByRole('heading', { name: /^tunnels$/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/trusted confidante/i)).toBeInTheDocument()
      expect(screen.getByText(/general collaborator/i)).toBeInTheDocument()
      expect(screen.getByText(/minimal disclosure/i)).toBeInTheDocument()
    })
  })

  it('Settings breadcrumb calls onBackToSettingsMain', async () => {
    const onBackToSettingsMain = vi.fn()
    render(BrainAccessPage, {
      props: { onSettingsNavigate: vi.fn(), onBackToSettingsMain },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /^settings$/i })).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: /^settings$/i }))
    expect(onBackToSettingsMain).toHaveBeenCalled()
  })
})
