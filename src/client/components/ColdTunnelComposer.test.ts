import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import ColdTunnelComposer from './ColdTunnelComposer.svelte'
import { apiFetch } from '@client/lib/apiFetch.js'

vi.mock('@client/lib/apiFetch.js', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('@client/lib/app/appEvents.js', () => ({
  emit: vi.fn(),
}))

const mockedApiFetch = vi.mocked(apiFetch)

describe('ColdTunnelComposer.svelte', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset()
  })

  it('submits targetUserId when a directory row is picked', async () => {
    const onSubmitted = vi.fn()
    const onDismiss = vi.fn()
    mockedApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ sessionId: 'sess-cold-1' }), { status: 200 }),
    )

    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                userId: 'usr_peer111111111111111111',
                handle: 'peer-one',
                displayName: 'Peer One',
                primaryEmail: 'p@example.com',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch

    render(ColdTunnelComposer, {
      props: { layout: 'inline', onDismiss, onSubmitted },
    })

    const search = screen.getByPlaceholderText(/search by name/i)
    await fireEvent.input(search, { target: { value: 'peer' } })

    await waitFor(() => {
      expect(screen.getByText('@peer-one')).toBeInTheDocument()
    })
    await fireEvent.mouseDown(screen.getByText('@peer-one').closest('button')!)

    const msg = screen.getByPlaceholderText(/what do you want to ask/i)
    await fireEvent.input(msg, { target: { value: 'Hello there' } })

    await fireEvent.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      expect(mockedApiFetch).toHaveBeenCalledWith(
        '/api/chat/b2b/cold-query',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ targetUserId: 'usr_peer111111111111111111', message: 'Hello there' }),
        }),
      )
      expect(onSubmitted).toHaveBeenCalledWith('sess-cold-1')
    })
  })
})
