import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { resetConnectionStatusForTests } from '../connectionStatus.js'
import {
  resetHubNotificationsRefreshSubscribersForTests,
  resetTunnelActivitySubscribersForTests,
  startHubEventsConnection,
  subscribeHubNotificationsRefresh,
  subscribeTunnelActivity,
} from './hubEventsClient.js'
import { backgroundAgentsFromEvents, yourWikiDocFromEvents } from './hubEventsStores.js'
import type { BackgroundAgentDoc } from '../statusBar/backgroundAgentTypes.js'

type EventSourceListener = (ev: MessageEvent) => void

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null

  private listeners = new Map<string, EventSourceListener[]>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventSourceListener) {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  close() {
    this.readyState = 2
  }

  simulateOpen() {
    this.readyState = 1
    this.onopen?.()
  }

  simulateError() {
    this.onerror?.()
  }

  simulateMessage(type: string, data: unknown) {
    const listeners = this.listeners.get(type)
    if (listeners) {
      const event = new MessageEvent(type, { data: JSON.stringify(data) })
      listeners.forEach((fn) => fn(event))
    }
  }

  simulateRawData(type: string, data: string) {
    const listeners = this.listeners.get(type)
    if (listeners) {
      const event = new MessageEvent(type, { data })
      listeners.forEach((fn) => fn(event))
    }
  }

  static clear() {
    MockEventSource.instances = []
  }

  static latest(): MockEventSource | undefined {
    return MockEventSource.instances[MockEventSource.instances.length - 1]
  }
}

describe('hubEventsClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.clear()
    vi.stubGlobal('EventSource', MockEventSource)
    resetConnectionStatusForTests()
    resetHubNotificationsRefreshSubscribersForTests()
    resetTunnelActivitySubscribersForTests()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ unlocked: true }), { status: 200 })),
      ),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetConnectionStatusForTests()
    resetHubNotificationsRefreshSubscribersForTests()
    resetTunnelActivitySubscribersForTests()
    yourWikiDocFromEvents.set(null)
    backgroundAgentsFromEvents.set([])
  })

  it('creates EventSource to /api/events on start', () => {
    const stop = startHubEventsConnection()
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.latest()?.url).toBe('/api/events')
    stop()
  })

  it('closes EventSource when stopped', () => {
    const stop = startHubEventsConnection()
    const es = MockEventSource.latest()!
    expect(es.readyState).toBe(0)

    stop()
    expect(es.readyState).toBe(2)
  })

  describe('your_wiki event', () => {
    it('updates yourWikiDocFromEvents store on valid message', () => {
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      const doc: BackgroundAgentDoc = {
        id: 'wiki-1',
        kind: 'your_wiki',
        status: 'running',
        label: 'Your Wiki',
        detail: 'Processing...',
        pageCount: 5,
        logLines: [],
        startedAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:01:00Z',
      }

      es.simulateMessage('your_wiki', doc)
      expect(get(yourWikiDocFromEvents)).toEqual(doc)
      stop()
    })

    it('ignores invalid JSON in your_wiki event', () => {
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      const listeners = (es as unknown as { listeners: Map<string, EventSourceListener[]> }).listeners
      const yourWikiListeners = listeners.get('your_wiki')
      expect(yourWikiListeners).toBeDefined()

      const event = new MessageEvent('your_wiki', { data: 'not valid json' })
      expect(() => yourWikiListeners![0](event)).not.toThrow()
      expect(get(yourWikiDocFromEvents)).toBeNull()
      stop()
    })
  })

  describe('background_agents event', () => {
    it('updates backgroundAgentsFromEvents store on valid message', () => {
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      const agents: BackgroundAgentDoc[] = [
        {
          id: 'agent-1',
          kind: 'background',
          status: 'running',
          label: 'Agent 1',
          detail: '',
          pageCount: 0,
          logLines: [],
          startedAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:01:00Z',
        },
      ]

      es.simulateMessage('background_agents', { agents })
      expect(get(backgroundAgentsFromEvents)).toEqual(agents)
      stop()
    })

    it('ignores messages without agents array', () => {
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      es.simulateMessage('background_agents', { notAgents: [] })
      expect(get(backgroundAgentsFromEvents)).toEqual([])
      stop()
    })

    it('ignores invalid JSON in background_agents event', () => {
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      const listeners = (es as unknown as { listeners: Map<string, EventSourceListener[]> }).listeners
      const bgListeners = listeners.get('background_agents')
      expect(bgListeners).toBeDefined()

      const event = new MessageEvent('background_agents', { data: 'broken json' })
      expect(() => bgListeners![0](event)).not.toThrow()
      expect(get(backgroundAgentsFromEvents)).toEqual([])
      stop()
    })
  })

  describe('reconnection', () => {
    it('schedules reconnect on error with initial backoff', () => {
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      es.simulateError()
      expect(MockEventSource.instances).toHaveLength(1)

      vi.advanceTimersByTime(1000)
      expect(MockEventSource.instances).toHaveLength(2)
      stop()
    })

    it('doubles backoff on successive errors up to max', () => {
      const stop = startHubEventsConnection()

      MockEventSource.latest()!.simulateError()
      vi.advanceTimersByTime(1000)
      expect(MockEventSource.instances).toHaveLength(2)

      MockEventSource.latest()!.simulateError()
      vi.advanceTimersByTime(2000)
      expect(MockEventSource.instances).toHaveLength(3)

      MockEventSource.latest()!.simulateError()
      vi.advanceTimersByTime(4000)
      expect(MockEventSource.instances).toHaveLength(4)

      stop()
    })

    it('resets backoff on successful open', () => {
      const stop = startHubEventsConnection()

      MockEventSource.latest()!.simulateError()
      vi.advanceTimersByTime(1000)
      MockEventSource.latest()!.simulateError()
      vi.advanceTimersByTime(2000)

      MockEventSource.latest()!.simulateOpen()
      MockEventSource.latest()!.simulateError()

      vi.advanceTimersByTime(1000)
      expect(MockEventSource.instances).toHaveLength(4)
      stop()
    })

    it('does not reconnect after stop', () => {
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      stop()
      es.simulateError()

      vi.advanceTimersByTime(10_000)
      expect(MockEventSource.instances).toHaveLength(1)
    })

    it('cancels pending reconnect timer on stop', () => {
      const stop = startHubEventsConnection()
      MockEventSource.latest()!.simulateError()

      stop()
      vi.advanceTimersByTime(10_000)
      expect(MockEventSource.instances).toHaveLength(1)
    })
  })

  describe('notifications_changed', () => {
    it('invokes subscribers on notifications_changed', () => {
      const cb = vi.fn()
      subscribeHubNotificationsRefresh(cb)
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      es.simulateMessage('notifications_changed', {})
      expect(cb).toHaveBeenCalledTimes(1)
      stop()
    })

    it('invokes subscribers on EventSource open (reconnect refresh)', () => {
      const cb = vi.fn()
      subscribeHubNotificationsRefresh(cb)
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      es.simulateOpen()
      expect(cb).toHaveBeenCalledTimes(1)
      stop()
    })

    it('unsubscribe stops notifications_changed delivery', () => {
      const cb = vi.fn()
      const unsub = subscribeHubNotificationsRefresh(cb)
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!
      unsub()

      es.simulateMessage('notifications_changed', {})
      expect(cb).not.toHaveBeenCalled()
      stop()
    })
  })

  describe('tunnel_activity', () => {
    it('invokes subscriber with parsed payload', () => {
      const cb = vi.fn()
      subscribeTunnelActivity(cb)
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!
      es.simulateMessage('tunnel_activity', { scope: 'outbound', outboundSessionId: 's1', grantId: 'g1' })
      expect(cb).toHaveBeenCalledWith({ scope: 'outbound', outboundSessionId: 's1', grantId: 'g1' })
      stop()
    })

    it('empty data invokes subscriber with null', () => {
      const cb = vi.fn()
      subscribeTunnelActivity(cb)
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!
      es.simulateRawData('tunnel_activity', '')
      expect(cb).toHaveBeenCalledWith(null)
      stop()
    })

    it('EventSource open invokes tunnel subscriber with null', () => {
      const cb = vi.fn()
      subscribeTunnelActivity(cb)
      const stop = startHubEventsConnection()
      MockEventSource.latest()!.simulateOpen()
      expect(cb).toHaveBeenCalledWith(null)
      stop()
    })
  })

  describe('ping event', () => {
    it('registers ping listener without error', () => {
      const stop = startHubEventsConnection()
      const es = MockEventSource.latest()!

      const listeners = (es as unknown as { listeners: Map<string, EventSourceListener[]> }).listeners
      expect(listeners.get('ping')).toBeDefined()
      stop()
    })
  })

  it('is idempotent - calling stop multiple times is safe', () => {
    const stop = startHubEventsConnection()
    stop()
    expect(() => stop()).not.toThrow()
  })
})
