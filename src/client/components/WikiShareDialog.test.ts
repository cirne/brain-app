import { describe, it, expect, vi, beforeEach } from 'vitest'
import WikiShareDialog from './WikiShareDialog.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'

function apiRow(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'wsh_test123456789012',
    ownerId: 'usr_owner',
    ownerHandle: 'owner',
    granteeEmail: 'friend@example.com',
    granteeId: null,
    pathPrefix: 'trips/',
    targetKind: 'dir' as const,
    createdAtMs: Date.now(),
    acceptedAtMs: null,
    revokedAtMs: null,
    ...overrides,
  }
}

describe('WikiShareDialog.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/api/wiki-shares') && !url.includes('/accept')) {
        return {
          ok: true,
          json: async () => ({ owned: [], received: [], pendingReceived: [] }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ results: [] }),
      } as Response
    }) as typeof fetch
  })

  it('uses Share Page label for file targets', () => {
    render(WikiShareDialog, {
      props: {
        open: true,
        pathPrefix: 'travel/note.md',
        targetKind: 'file',
        onDismiss: vi.fn(),
      },
    })

    expect(screen.getByRole('button', { name: /share page/i })).toBeInTheDocument()
  })

  it('shares with a typed email, clears input, and reloads audience with pending row', async () => {
    let capturedBody = ''
    const row = apiRow({ granteeEmail: 'friend@example.com' })
    let listOwned: unknown[] = []

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'
      if (urlStr.includes('/api/wiki-shares') && method === 'GET') {
        return new Response(JSON.stringify({ owned: listOwned, received: [], pendingReceived: [] }), {
          status: 200,
        })
      }
      if (urlStr.includes('/api/account/workspace-handles')) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }
      expect(method).toBe('POST')
      capturedBody = (init?.body as string) ?? ''
      listOwned = [row]
      return new Response(JSON.stringify(row), { status: 200 })
    }) as typeof fetch

    render(WikiShareDialog, {
      props: {
        open: true,
        pathPrefix: 'trips/',
        targetKind: 'dir',
        onDismiss: vi.fn(),
      },
    })

    const input = screen.getByPlaceholderText('@handle or name@example.com')
    await fireEvent.input(input, { target: { value: 'friend@example.com' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await fireEvent.click(screen.getByRole('button', { name: /share folder/i }))

    await waitFor(() => {
      expect(capturedBody).toContain('"granteeEmail":"friend@example.com"')
    })

    await waitFor(() => {
      expect(screen.getByText('friend@example.com')).toBeInTheDocument()
      expect(screen.getByText(/pending/i)).toBeInTheDocument()
    })

    const inputAfter = screen.getByPlaceholderText('@handle or name@example.com') as HTMLInputElement
    expect(inputAfter.value).toBe('')
    expect(screen.queryByRole('button', { name: /copy legacy link/i })).not.toBeInTheDocument()
  })

  it('autocompletes a handle and POSTs granteeHandle', async () => {
    let capturedBody = ''
    const row = apiRow({
      granteeEmail: 'cirne@example.com',
      granteeHandle: 'cirne',
    })
    let listOwned: unknown[] = []

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'
      if (urlStr.includes('/api/wiki-shares') && method === 'GET') {
        return new Response(JSON.stringify({ owned: listOwned, received: [], pendingReceived: [] }), {
          status: 200,
        })
      }
      if (urlStr.includes('/api/account/workspace-handles')) {
        expect(urlStr).toMatch(/\/api\/account\/workspace-handles\?q=cir/)
        return new Response(
          JSON.stringify({
            results: [
              {
                userId: 'usr_aaaa',
                handle: 'cirne',
                displayName: 'Lewis Cirne',
                primaryEmail: 'cirne@example.com',
              },
            ],
          }),
          { status: 200 },
        )
      }
      expect(method).toBe('POST')
      capturedBody = (init?.body as string) ?? ''
      listOwned = [row]
      return new Response(JSON.stringify(row), { status: 200 })
    }) as typeof fetch

    render(WikiShareDialog, {
      props: {
        open: true,
        pathPrefix: 'trips/',
        targetKind: 'dir',
        onDismiss: vi.fn(),
      },
    })

    const input = screen.getByPlaceholderText('@handle or name@example.com')
    await fireEvent.input(input, { target: { value: '@cir' } })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /@cirne.*Lewis Cirne/i })).toBeInTheDocument()
    })

    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByLabelText(/Remove @cirne/i)).toBeInTheDocument()
    expect(screen.getAllByText(/cirne@example\.com/).length).toBeGreaterThan(0)

    await fireEvent.click(screen.getByRole('button', { name: /share folder/i }))

    await waitFor(() => {
      const parsed = JSON.parse(capturedBody) as { granteeHandle?: string; granteeEmail?: string }
      expect(parsed.granteeHandle).toBe('cirne')
      expect(parsed.granteeEmail).toBeUndefined()
    })

    await waitFor(() => {
      expect(screen.getByText('cirne@example.com')).toBeInTheDocument()
    })
  })

  it('submits multiple grantees in one click and reports per-grantee errors', async () => {
    const sterlingRow = apiRow({
      id: 'wsh_ster',
      granteeEmail: 'sterling@example.com',
      granteeHandle: 'sterling',
    })
    let listOwned: unknown[] = []
    let inviteIdx = 0

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'

      if (urlStr.includes('/api/wiki-shares') && method === 'GET') {
        return new Response(JSON.stringify({ owned: listOwned, received: [], pendingReceived: [] }), {
          status: 200,
        })
      }

      if (urlStr.includes('/api/account/workspace-handles')) {
        if (urlStr.includes('q=ster')) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  userId: 'usr_s',
                  handle: 'sterling',
                  displayName: 'Sterling Smith',
                  primaryEmail: 'sterling@example.com',
                },
              ],
            }),
            { status: 200 },
          )
        }
        if (urlStr.includes('q=donn')) {
          return new Response(
            JSON.stringify({
              results: [{ userId: 'usr_d', handle: 'donna', primaryEmail: null }],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }

      expect(method).toBe('POST')
      const body = (init?.body as string) ?? ''
      const parsed = JSON.parse(body) as { granteeHandle?: string }
      inviteIdx += 1
      if (parsed.granteeHandle === 'sterling') {
        listOwned = [sterlingRow]
        return new Response(JSON.stringify(sterlingRow), { status: 200 })
      }
      return new Response(
        JSON.stringify({ error: 'handle_has_no_email', message: '@donna has not connected an email account yet.' }),
        { status: 400 },
      )
    }) as typeof fetch

    render(WikiShareDialog, {
      props: {
        open: true,
        pathPrefix: 'trips/',
        targetKind: 'dir',
        onDismiss: vi.fn(),
      },
    })

    const input = screen.getByPlaceholderText('@handle or name@example.com')

    await fireEvent.input(input, { target: { value: '@ster' } })
    await waitFor(() => screen.getByRole('option', { name: /@sterling/ }))
    await fireEvent.keyDown(input, { key: 'Enter' })

    await fireEvent.input(input, { target: { value: '@donn' } })
    await waitFor(() => screen.getByRole('option', { name: /@donna/ }))
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByText('@sterling')).toBeInTheDocument()
    expect(screen.getByText('@donna')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /share folder/i }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /sharing…/i })).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText(/@donna.*not connected/i)).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('sterling@example.com')).toBeInTheDocument()
    })
    expect(inviteIdx).toBe(2)
  })

  it('disables submit when a selected handle has no connected email', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'

      if (urlStr.includes('/api/wiki-shares') && method === 'GET') {
        return new Response(JSON.stringify({ owned: [], received: [], pendingReceived: [] }), { status: 200 })
      }

      expect(urlStr).toContain('/api/account/workspace-handles')
      return new Response(
        JSON.stringify({ results: [{ userId: 'usr_n', handle: 'newcomer', primaryEmail: null }] }),
        { status: 200 },
      )
    }) as typeof fetch

    render(WikiShareDialog, {
      props: {
        open: true,
        pathPrefix: 'trips/',
        targetKind: 'dir',
        onDismiss: vi.fn(),
      },
    })

    const input = screen.getByPlaceholderText('@handle or name@example.com')
    await fireEvent.input(input, { target: { value: '@new' } })
    await waitFor(() => screen.getByRole('option', { name: /@newcomer/ }))
    await fireEvent.keyDown(input, { key: 'Enter' })

    const submitBtn = screen.getByRole('button', { name: /share folder/i })
    expect(submitBtn).toBeDisabled()
    expect(screen.getByText(/cannot receive invites yet/i)).toBeInTheDocument()
  })

  it('revokes a grantee and calls onSharesChanged', async () => {
    const onSharesChanged = vi.fn()
    const row = {
      id: 'wsh_rev',
      ownerId: 'usr_me',
      ownerHandle: 'me',
      granteeEmail: 'friend@example.com',
      granteeId: null as string | null,
      pathPrefix: 'trips/',
      targetKind: 'dir' as const,
      createdAtMs: Date.now(),
      acceptedAtMs: null as number | null,
      revokedAtMs: null as number | null,
    }
    let revoked = false
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'

      if (method === 'DELETE' && urlStr.includes('wsh_rev')) {
        revoked = true
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }

      if (urlStr.includes('/api/wiki-shares') && method === 'GET') {
        const owns = revoked ? [] : [row]
        return new Response(JSON.stringify({ owned: owns, received: [], pendingReceived: [] }), { status: 200 })
      }

      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 })
    }) as typeof fetch
    render(WikiShareDialog, {
      props: {
        open: true,
        pathPrefix: 'trips/',
        targetKind: 'dir',
        onDismiss: vi.fn(),
        onSharesChanged,
      },
    })
    await waitFor(() => {
      expect(screen.getByText('friend@example.com')).toBeInTheDocument()
    })
    await fireEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[0]!)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /remove access/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[1]!)
    await waitFor(() => {
      expect(onSharesChanged).toHaveBeenCalled()
      expect(screen.getByText(/only you/i)).toBeInTheDocument()
    })
  })
})
