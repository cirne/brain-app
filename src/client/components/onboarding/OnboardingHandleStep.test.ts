import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@client/test/render.js'
import OnboardingHandleStep from './OnboardingHandleStep.svelte'

vi.mock('@client/lib/accountClient.js', () => ({
  fetchAccountHandle: vi.fn(),
  checkHandleAvailability: vi.fn(),
  postConfirmHandle: vi.fn(),
}))

import * as accountClient from '@client/lib/accountClient.js'

describe('OnboardingHandleStep.svelte', () => {
  beforeEach(() => {
    vi.mocked(accountClient.fetchAccountHandle).mockResolvedValue({
      userId: 'usr_aaaaaaaaaaaaaaaaaaaa',
      handle: 'usr_aaaaaaaaaaaaaaaaaaaa',
      confirmedAt: null,
      suggestedHandle: 'testhandle',
    })
    vi.mocked(accountClient.checkHandleAvailability).mockResolvedValue({
      available: true,
      handle: 'testhandle',
    })
  })

  it('focuses the handle input when the step mounts', async () => {
    render(OnboardingHandleStep, {
      props: {
        refreshStatus: vi.fn(async () => {}),
        onComplete: vi.fn(async () => {}),
      },
    })

    await waitFor(() => {
      expect(document.getElementById('ob-handle-input')).toBe(document.activeElement)
    })
  })
})
