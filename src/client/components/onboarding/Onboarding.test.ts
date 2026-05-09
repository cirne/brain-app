import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/svelte'
import OnboardingFirstRunPanel from './OnboardingFirstRunPanel.svelte'

function stubFetchForOnboardingAgent() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (u.includes('/api/onboarding/status')) {
        return new Response(JSON.stringify({ state: 'onboarding-agent' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (u.includes('/api/onboarding/preferences')) {
        return new Response(
          JSON.stringify({ mailProvider: null, appleLocalIntegrationsAvailable: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (u.includes('/api/onboarding/mail')) {
        return new Response(
          JSON.stringify({
            configured: false,
            indexedTotal: null,
            lastSyncedAt: null,
            dateRange: { from: null, to: null },
            syncRunning: false,
            refreshRunning: false,
            backfillRunning: false,
            syncLockAgeMs: null,
            ftsReady: null,
            messageAvailableForProgress: null,
            pendingBackfill: false,
            staleMailSyncLock: false,
            indexingHint: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('unexpected', { status: 404 })
    }),
  )
}

describe('OnboardingFirstRunPanel.svelte', () => {
  beforeEach(() => {
    stubFetchForOnboardingAgent()
  })

  it('points guided setup to Chat while mail may still index', async () => {
    render(OnboardingFirstRunPanel, {
      props: {
        refreshStatus: vi.fn(async () => {}),
        multiTenant: false,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Guided setup continues in/)
    })
    expect(screen.getByRole('status')).toHaveTextContent(/Chat/)
  })

  it('welcome panel root stretches so hero shells can vertically center', async () => {
    const { container } = render(OnboardingFirstRunPanel, {
      props: {
        refreshStatus: vi.fn(async () => {}),
        multiTenant: false,
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Guided setup continues in/)
    })

    const root = container.querySelector('.onboarding')
    expect(root?.className.includes('flex-1')).toBe(true)
  })
})
