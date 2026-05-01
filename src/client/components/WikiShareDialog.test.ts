import { describe, it, expect, vi, beforeEach } from 'vitest'
import WikiShareDialog from './WikiShareDialog.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'

type FetchCall = { url: string; init?: RequestInit }

function makeFetch(handlers: Array<(call: FetchCall) => Response | Promise<Response>>): typeof fetch {
  let i = 0
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const handler = handlers[Math.min(i, handlers.length - 1)]!
    i += 1
    return handler({ url, init })
  }) as typeof fetch
}

describe('WikiShareDialog.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ results: [] }),
      } as Response
    }) as typeof fetch
  })

  it('shares with a typed email and shows the invite link', async () => {
    let capturedBody = ''
    globalThis.fetch = makeFetch([
      ({ url, init }) => {
        if (url.includes('/api/account/workspace-handles')) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 })
        }
        capturedBody = (init?.body as string) ?? ''
        return new Response(
          JSON.stringify({
            inviteUrl: 'https://x.example/api/wiki-shares/accept/abc',
            emailSent: false,
          }),
          { status: 200 },
        )
      },
    ])

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
    await fireEvent.click(screen.getByRole('button', { name: /create invite/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/Invite link for friend@example\.com/i)).toHaveValue(
        'https://x.example/api/wiki-shares/accept/abc',
      )
    })
    expect(capturedBody).toContain('"granteeEmail":"friend@example.com"')
  })

  it('autocompletes a handle and POSTs granteeHandle', async () => {
    let capturedBody = ''
    globalThis.fetch = makeFetch([
      ({ url }) => {
        expect(url).toMatch(/\/api\/account\/workspace-handles\?q=cir/)
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
      },
      ({ url, init }) => {
        expect(url).toContain('/api/wiki-shares')
        capturedBody = (init?.body as string) ?? ''
        return new Response(
          JSON.stringify({
            inviteUrl: 'https://x.example/api/wiki-shares/accept/cirne-token',
            emailSent: true,
            granteeHandle: 'cirne',
          }),
          { status: 200 },
        )
      },
    ])

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

    await fireEvent.click(screen.getByRole('button', { name: /create invite/i }))

    await waitFor(() => {
      expect(screen.getByText(/Email sent/i)).toBeInTheDocument()
    })
    const parsed = JSON.parse(capturedBody) as { granteeHandle?: string; granteeEmail?: string }
    expect(parsed.granteeHandle).toBe('cirne')
    expect(parsed.granteeEmail).toBeUndefined()
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
    globalThis.fetch = makeFetch([
      ({ url }) => {
        if (url.includes('q=ster')) {
          return new Response(
            JSON.stringify({
              results: [
                { userId: 'usr_s', handle: 'sterling', displayName: 'Sterling Smith', primaryEmail: 'sterling@example.com' },
              ],
            }),
            { status: 200 },
          )
        }
        if (url.includes('q=donn')) {
          return new Response(
            JSON.stringify({
              results: [
                { userId: 'usr_d', handle: 'donna', primaryEmail: null },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      },
      ({ url }) => {
        if (url.includes('q=donn')) {
          return new Response(
            JSON.stringify({
              results: [
                { userId: 'usr_d', handle: 'donna', primaryEmail: null },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ results: [] }), { status: 200 })
      },
      ({ init }) => {
        const c = inviteCalls[inviteIdx]!
        c.body = (init?.body as string) ?? ''
        inviteIdx += 1
        return new Response(JSON.stringify(c.payload), { status: c.status })
      },
      ({ init }) => {
        const c = inviteCalls[inviteIdx]!
        c.body = (init?.body as string) ?? ''
        inviteIdx += 1
        return new Response(JSON.stringify(c.payload), { status: c.status })
      },
    ])

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

    await fireEvent.click(screen.getByRole('button', { name: /create invites/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/Invite link for sterling/i)).toHaveValue(
        'https://x.example/api/wiki-shares/accept/sterling-token',
      )
    })
    expect(screen.getByText(/@donna:.*has not connected an email/)).toBeInTheDocument()
  })

  it('disables submit when a selected handle has no connected email', async () => {
    globalThis.fetch = makeFetch([
      () =>
        new Response(
          JSON.stringify({ results: [{ userId: 'usr_n', handle: 'newcomer', primaryEmail: null }] }),
          { status: 200 },
        ),
    ])

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

    const submitBtn = screen.getByRole('button', { name: /create invite/i })
    expect(submitBtn).toBeDisabled()
    expect(screen.getByText(/cannot receive invites yet/i)).toBeInTheDocument()
  })
})
