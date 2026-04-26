import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@client/test/render.js'
import OnboardingSeedingInterstitial from './OnboardingSeedingInterstitial.svelte'

const stopHub = vi.fn()

vi.mock('@client/lib/hubEvents/hubEventsClient.js', () => ({
  startHubEventsConnection: vi.fn(() => {
    return stopHub
  }),
}))

describe('OnboardingSeedingInterstitial.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input)
      if (u.includes('/api/your-wiki')) {
        return {
          ok: true,
          json: async () => ({
            id: 'your-wiki',
            kind: 'your-wiki',
            status: 'running',
            label: 'Your Wiki',
            detail: '',
            pageCount: 0,
            logLines: [],
            startedAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          }),
        } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    }) as typeof fetch
  })

  it('starts the hub /api/events connection so the Your Wiki feed receives live your_wiki SSE', async () => {
    const { startHubEventsConnection } = await import('@client/lib/hubEvents/hubEventsClient.js')

    render(OnboardingSeedingInterstitial, {
      props: {
        onContinue: () => {},
        continueBusy: false,
      },
    })

    expect(vi.mocked(startHubEventsConnection)).toHaveBeenCalledTimes(1)
  })
})
