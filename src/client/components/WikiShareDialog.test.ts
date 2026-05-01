import { describe, it, expect, vi, beforeEach } from 'vitest'
import WikiShareDialog from './WikiShareDialog.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'

describe('WikiShareDialog.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          inviteUrl: 'https://x.example/api/wiki-shares/accept/abc',
          emailSent: false,
        }),
      } as Response
    }) as typeof fetch
  })

  it('submits email and shows invite link', async () => {
    const onDismiss = vi.fn()
    render(WikiShareDialog, {
      props: {
        open: true,
        pathPrefix: 'trips/',
        onDismiss,
      },
    })

    await fireEvent.input(screen.getByLabelText(/grantee email/i), {
      target: { value: 'friend@example.com' },
    })
    await fireEvent.click(screen.getByRole('button', { name: /create invite/i }))

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /invite link/i })).toHaveValue(
        'https://x.example/api/wiki-shares/accept/abc',
      )
    })
    expect(globalThis.fetch).toHaveBeenCalled()
  })
})
