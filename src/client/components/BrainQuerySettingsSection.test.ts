import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BrainQuerySettingsSection from './BrainQuerySettingsSection.svelte'
import { render, screen, waitFor } from '@client/test/render.js'

describe('BrainQuerySettingsSection.svelte', () => {
  const prevFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = prevFetch
  })

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/api/brain-query/grants')) {
        return new Response(
          JSON.stringify({
            grantedByMe: [
              {
                id: 'bqg_test00000000000001',
                ownerId: 'usr_oo',
                ownerHandle: 'me',
                askerId: 'usr_aa',
                askerHandle: 'ally',
                privacyPolicy: 'Default policy text',
                createdAtMs: Date.now(),
                updatedAtMs: Date.now(),
              },
            ],
            grantedToMe: [],
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/brain-query/log')) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
  })

  it('loads grants and shows policy textarea', async () => {
    render(BrainQuerySettingsSection)
    await waitFor(() => {
      expect(screen.getByDisplayValue('Default policy text')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Brain queries', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('@ally')).toBeInTheDocument()
  })
})
