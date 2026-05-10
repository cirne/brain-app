import { beforeEach, describe, expect, it, vi } from 'vitest'

const abortFn = vi.fn()

vi.mock('./profilingAgent.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./profilingAgent.js')>()
  return {
    ...actual,
    fetchRipmailWhoamiForProfiling: vi.fn().mockResolvedValue('{}'),
  }
})

vi.mock('./agentFactory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agentFactory.js')>()
  return {
    ...actual,
    createOnboardingAgent: vi.fn(() => ({ abort: abortFn })),
  }
})

import {
  clearAllInterviewSessions,
  deleteInterviewSession,
  getOrCreateOnboardingInterviewAgent,
  peekOnboardingInterviewAgent,
} from './onboardingInterviewAgent.js'

describe('onboarding interview session lifecycle', () => {
  beforeEach(() => {
    clearAllInterviewSessions()
    abortFn.mockClear()
  })

  it('deleteInterviewSession aborts the agent before dropping it', async () => {
    await getOrCreateOnboardingInterviewAgent('session-abort-test')
    expect(peekOnboardingInterviewAgent('session-abort-test')).toBeDefined()
    deleteInterviewSession('session-abort-test')
    expect(abortFn).toHaveBeenCalledTimes(1)
    expect(peekOnboardingInterviewAgent('session-abort-test')).toBeUndefined()
  })
})
