import { describe, it, expect, vi, beforeEach } from 'vitest'
import WikiShareDialog from './WikiShareDialog.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'

describe('WikiShareDialog.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/api/wiki-shares') && !url.includes('/accept/')) {
        return {
          ok: true,
          json: async () => ({ owned: [], received: [] }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ results: [] }),
      } as Response
    }) as typeof fetch
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
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

  it('shares with a typed email and shows the invite link', async () => {
    let capturedBody = ''
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'
      if (
        urlStr.includes('/api/wiki-shares') &&
        !urlStr.includes('/accept/') &&
        method === 'GET'
      ) {
        return new Response(JSON.stringify({ owned: [], received: [] }), { status: 200 })
      }
      if (urlStr.includes('/api/account/workspace-handles')) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      }
      expect(method).toBe('POST')
      capturedBody = (init?.body as string) ?? ''
      return new Response(
        JSON.stringify({
          inviteUrl: 'https://x.example/api/wiki-shares/accept/abc',
          emailSent: false,
        }),
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
    await fireEvent.input(input, { target: { value: 'friend@example.com' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await fireEvent.click(screen.getByRole('button', { name: /share folder/i }))

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /copy legacy link/i }).length).toBeGreaterThan(0)
    })

    await fireEvent.click(screen.getAllByRole('button', { name: /copy legacy link/i })[0]!)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://x.example/api/wiki-shares/accept/abc',
    )
    expect(capturedBody).toContain('"granteeEmail":"friend@example.com"')
  })

  it('autocompletes a handle and POSTs granteeHandle', async () => {
    let capturedBody = ''
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'
      if (
        urlStr.includes('/api/wiki-shares') &&
        !urlStr.includes('/accept/') &&
        method === 'GET'
      ) {
        return new Response(JSON.stringify({ owned: [], received: [] }), { status: 200 })
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
      expect(urlStr).toContain('/api/wiki-shares')
      capturedBody = (init?.body as string) ?? ''
      return new Response(
        JSON.stringify({
          inviteUrl: 'https://x.example/api/wiki-shares/accept/cirne-token',
          emailSent: true,
          granteeHandle: 'cirne',
        }),
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
    await fireEvent.input(input, { target: { value: '@cir' } })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /@cirne.*Lewis Cirne/i })).toBeInTheDocument()
    })

    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByLabelText(/Remove @cirne/i)).toBeInTheDocument()
    expect(screen.getAllByText(/cirne@example\.com/).length).toBeGreaterThan(0)

    await fireEvent.click(screen.getByRole('checkbox'))

    await fireEvent.click(screen.getByRole('button', { name: /share folder/i }))

    await waitFor(() => {
      expect(screen.getByText(/Reminder emailed/i)).toBeInTheDocument()
    })
    const parsed = JSON.parse(capturedBody) as { granteeHandle?: string; granteeEmail?: string; notifyByEmail?: boolean }
    expect(parsed.granteeHandle).toBe('cirne')
    expect(parsed.granteeEmail).toBeUndefined()
    expect(parsed.notifyByEmail).toBe(true)
  })

  it('submits multiple grantees in one click and reports per-grantee errors', async () => {
    const inviteCalls: Array<{ body: string; status: number; payload: unknown }> = [
      {
        body: '',
        status: 200,
        payload: {
          inviteUrl: 'https://x.example/api/wiki-shares/accept/sterling-token',
          emailSent: false,
          granteeHandle: 'sterling',
        },
      },
      {
        body: '',
        status: 400,
        payload: { error: 'handle_has_no_email', message: '@donna has not connected an email account yet.' },
      },
    ]
    let inviteIdx = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'

      if (
        urlStr.includes('/api/wiki-shares') &&
        !urlStr.includes('/accept/') &&
        method === 'GET'
      ) {
        return new Response(JSON.stringify({ owned: [], received: [] }), { status: 200 })
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
      const c = inviteCalls[inviteIdx]!
      c.body = (init?.body as string) ?? ''
      inviteIdx += 1
      return new Response(JSON.stringify(c.payload), { status: c.status })
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
      expect(screen.getAllByRole('button', { name: /copy legacy link/i }).length).toBeGreaterThan(0)
    })
  })

  it('shows per-row Copy legacy link when two invites succeed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    let postN = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'

      if (
        urlStr.includes('/api/wiki-shares') &&
        !urlStr.includes('/accept/') &&
        method === 'GET'
      ) {
        return new Response(JSON.stringify({ owned: [], received: [] }), { status: 200 })
      }

      expect(method).toBe('POST')
      postN += 1
      const url =
        postN === 1
          ? 'https://x.example/a'
          : postN === 2
            ? 'https://x.example/b'
            : 'https://x.example/error'
      return new Response(JSON.stringify({ inviteUrl: url, emailSent: false }), { status: 200 })
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
    await fireEvent.input(input, { target: { value: 'a@x.com' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await fireEvent.input(input, { target: { value: 'b@y.com' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await fireEvent.click(screen.getByRole('button', { name: /share folder/i }))

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^copy legacy link$/i })).toHaveLength(2)
    })

    await fireEvent.click(screen.getAllByRole('button', { name: /^copy legacy link$/i })[0]!)
    expect(writeText).toHaveBeenCalledWith('https://x.example/a')
  })

  it('disables submit when a selected handle has no connected email', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? 'GET'

      if (
        urlStr.includes('/api/wiki-shares') &&
        !urlStr.includes('/accept/') &&
        method === 'GET'
      ) {
        return new Response(JSON.stringify({ owned: [], received: [] }), { status: 200 })
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

      if (
        urlStr.includes('/api/wiki-shares') &&
        !urlStr.includes('/accept/') &&
        method === 'GET'
      ) {
        const owns = revoked ? [] : [row]
        return new Response(JSON.stringify({ owned: owns, received: [] }), { status: 200 })
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
