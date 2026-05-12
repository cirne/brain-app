import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resetHubSseBrokerForTests,
  registerHubSseSubscriber,
  notifyBackgroundRunWritten,
  notifyNotificationsChanged,
  HUB_SSE_DEBOUNCE_MS,
} from './hubSseBroker.js'
import type { BackgroundRunDoc } from '@server/lib/chat/backgroundAgentStore.js'

vi.mock('./tenantContext.js', () => ({
  tryGetTenantContext: vi.fn(() => undefined),
}))

function baseYourWikiDoc(): BackgroundRunDoc {
  const now = new Date().toISOString()
  return {
    id: 'your-wiki',
    kind: 'your-wiki',
    status: 'running',
    label: 'Your Wiki',
    detail: 'x',
    pageCount: 1,
    logLines: [],
    startedAt: now,
    updatedAt: now,
    timeline: [],
  }
}

describe('hubSseBroker', () => {
  beforeEach(() => {
    resetHubSseBrokerForTests()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    resetHubSseBrokerForTests()
  })

  it('debounces rapid writes for the same doc id', async () => {
    const payloads: string[] = []
    registerHubSseSubscriber('_single', async ({ event, data }) => {
      payloads.push(`${event}:${data}`)
    })

    notifyBackgroundRunWritten(baseYourWikiDoc())
    notifyBackgroundRunWritten(baseYourWikiDoc())

    await vi.advanceTimersByTimeAsync(HUB_SSE_DEBOUNCE_MS + 5)
    for (let i = 0; i < 30 && payloads.length === 0; i++) {
      await Promise.resolve()
    }

    expect(payloads.length).toBe(1)
    expect(payloads[0]?.startsWith('your_wiki:')).toBe(true)
  })

  it('unregister stops delivery', async () => {
    const payloads: string[] = []
    const unsub = registerHubSseSubscriber('_single', async ({ event, data }) => {
      payloads.push(`${event}:${data}`)
    })
    unsub()

    notifyBackgroundRunWritten(baseYourWikiDoc())
    await vi.advanceTimersByTimeAsync(HUB_SSE_DEBOUNCE_MS + 5)

    expect(payloads.length).toBe(0)
  })

  it('debounces rapid notifyNotificationsChanged for the same workspace', async () => {
    const payloads: string[] = []
    registerHubSseSubscriber('_single', async ({ event, data }) => {
      payloads.push(`${event}:${data}`)
    })

    notifyNotificationsChanged()
    notifyNotificationsChanged()

    await vi.advanceTimersByTimeAsync(HUB_SSE_DEBOUNCE_MS + 5)
    for (let i = 0; i < 30 && payloads.length === 0; i++) {
      await Promise.resolve()
    }

    expect(payloads).toEqual(['notifications_changed:{}'])
  })
})
