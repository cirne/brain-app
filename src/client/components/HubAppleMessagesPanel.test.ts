import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import HubAppleMessagesPanel from './HubAppleMessagesPanel.svelte'

vi.mock('@client/lib/app/appEvents.js', () => ({
  subscribe: vi.fn(() => () => {}),
  emit: vi.fn(),
}))

function stubFetchDevicesEmpty(): typeof fetch {
  return vi.fn((url: RequestInfo) => {
    const u = String(url)
    if (u === '/api/devices') {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, devices: [] }), { status: 200 }))
    }
    if (u === '/api/onboarding/fda') {
      return Promise.resolve(new Response(JSON.stringify({ granted: true }), { status: 200 }))
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }) as unknown as typeof fetch
}

describe('HubAppleMessagesPanel.svelte', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', stubFetchDevicesEmpty())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders headline and primary turn-on control', async () => {
    const onClosePanel = vi.fn()
    render(HubAppleMessagesPanel, { props: { onClosePanel } })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Apple Messages on this Mac/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Turn on Messages sync/i })).toBeInTheDocument()
  })

  it('posts to /api/devices when Turn on is clicked', async () => {
    const fetchMock = vi.fn((url: RequestInfo, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/devices' && init?.method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, token: 'one-time-code' }), { status: 200 }),
        )
      }
      if (u === '/api/devices') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, devices: [] }), { status: 200 }))
      }
      if (u === '/api/onboarding/fda') {
        return Promise.resolve(new Response(JSON.stringify({ granted: true }), { status: 200 }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    render(HubAppleMessagesPanel, { props: { onClosePanel: vi.fn() } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Turn on Messages sync/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: /Turn on Messages sync/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/devices',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await waitFor(() => {
      expect(screen.getByDisplayValue('one-time-code')).toBeInTheDocument()
    })
  })

  it('shows Full Disk Access remediation when probe reports not granted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo) => {
        const u = String(url)
        if (u === '/api/devices') {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, devices: [] }), { status: 200 }))
        }
        if (u === '/api/onboarding/fda') {
          return Promise.resolve(new Response(JSON.stringify({ granted: false }), { status: 200 }))
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as unknown as typeof fetch,
    )

    render(HubAppleMessagesPanel, { props: { onClosePanel: vi.fn() } })

    await waitFor(() => {
      expect(screen.getByText(/Full Disk Access is off or not detected/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Open Full Disk Access help/i })).toBeInTheDocument()
  })
})
