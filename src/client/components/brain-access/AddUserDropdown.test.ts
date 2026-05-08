import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import AddUserDropdown from './AddUserDropdown.svelte'

describe('AddUserDropdown.svelte', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/api/account/workspace-handles')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                results: [
                  {
                    userId: 'u1',
                    handle: 'donna',
                    displayName: 'Donna Chen',
                    primaryEmail: 'donna@example.com',
                  },
                ],
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as typeof fetch,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens list and shows handle, name, and email in rows', async () => {
    const onPick = vi.fn()
    render(AddUserDropdown, { props: { onPick } })
    await fireEvent.click(screen.getByRole('button', { name: /add user/i }))
    const search = screen.getByPlaceholderText(/search @handle/i)
    await fireEvent.input(search, { target: { value: 'don' } })
    expect(await screen.findByText('@donna')).toBeInTheDocument()
    expect(screen.getByText(/Donna Chen/)).toBeInTheDocument()
    expect(screen.getByText(/donna@example\.com/)).toBeInTheDocument()
    await fireEvent.mouseDown(screen.getByRole('option', { name: /@donna/i }))
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'donna', displayName: 'Donna Chen', primaryEmail: 'donna@example.com' }),
    )
  })
})
