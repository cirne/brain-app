import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/svelte'
import Onboarding from './Onboarding.svelte'

vi.mock('./OnboardingWorkspace.svelte', () => import('../test-stubs/OnboardingWorkspaceStub.svelte'))

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

describe('Onboarding.svelte', () => {
  beforeEach(() => {
    stubFetchForOnboardingAgent()
  })

  it('does not render the manual “finish setup” footer during guided interview', async () => {
    render(Onboarding, {
      props: {
        onComplete: vi.fn(async () => {}),
        refreshStatus: vi.fn(async () => {}),
        multiTenant: false,
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-workspace-stub')).toBeInTheDocument()
    })

    expect(screen.queryByRole('region', { name: 'Finish setup' })).not.toBeInTheDocument()
    expect(screen.queryByText(/When you’re done with setup/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continue to Braintunnel/i })).not.toBeInTheDocument()
  })
})
