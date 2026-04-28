import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockFetch, jsonResponse } from '@client/test/mocks/fetch.js'
import * as appEvents from './app/appEvents.js'
import {
  addToNavHistory,
  clearNavHistory,
  loadNavHistory,
  makeNavHistoryId,
  removeFromNavHistory,
  upsertEmailNavHistory,
  type NavHistoryItem,
} from './navHistory.js'

describe('navHistory', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    emitSpy = vi.spyOn(appEvents, 'emit')
  })

  afterEach(() => {
    emitSpy.mockRestore()
  })

  describe('makeNavHistoryId', () => {
    it('concatenates type and identifier with colon', () => {
      expect(makeNavHistoryId('chat', 'abc123')).toBe('chat:abc123')
      expect(makeNavHistoryId('email', 'thread-42')).toBe('email:thread-42')
      expect(makeNavHistoryId('doc', '/notes/meeting.md')).toBe('doc:/notes/meeting.md')
    })
  })

  describe('loadNavHistory', () => {
    it('returns items array on success', async () => {
      const items: NavHistoryItem[] = [
        { id: 'doc:test', type: 'doc', title: 'Test Doc', accessedAt: '2024-01-01T00:00:00Z' },
      ]
      const mockFetch = createMockFetch([
        { match: (url) => url === '/api/nav/recents', response: () => jsonResponse(items) },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const result = await loadNavHistory()
      expect(result).toEqual(items)
    })

    it('returns empty array on non-ok response', async () => {
      const mockFetch = createMockFetch([
        { match: (url) => url === '/api/nav/recents', response: () => jsonResponse({}, 401) },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const result = await loadNavHistory()
      expect(result).toEqual([])
    })

    it('returns empty array on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const result = await loadNavHistory()
      expect(result).toEqual([])
    })

    it('returns empty array if response is not an array', async () => {
      const mockFetch = createMockFetch([
        { match: (url) => url === '/api/nav/recents', response: () => jsonResponse({ notAnArray: true }) },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const result = await loadNavHistory()
      expect(result).toEqual([])
    })
  })

  describe('addToNavHistory', () => {
    it('posts item and emits recents-changed when server reports updated', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents' && init?.method === 'POST',
          response: () => jsonResponse({ ok: true, updated: true }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      await addToNavHistory({ id: 'doc:test', type: 'doc', title: 'Test', path: '/test.md' })

      expect(mockFetch).toHaveBeenCalledWith('/api/nav/recents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'doc:test', type: 'doc', title: 'Test', path: '/test.md', meta: undefined }),
      })
      expect(emitSpy).toHaveBeenCalledWith({ type: 'nav:recents-changed' })
    })

    it('does not emit when server reports duplicate no-op', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents' && init?.method === 'POST',
          response: () => jsonResponse({ ok: true, updated: false }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      await addToNavHistory({ id: 'doc:test', type: 'doc', title: 'Test', path: '/test.md' })

      expect(emitSpy).not.toHaveBeenCalled()
    })

    it('emits when response omits updated (older servers)', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents' && init?.method === 'POST',
          response: () => jsonResponse({ ok: true }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      await addToNavHistory({ id: 'doc:test', type: 'doc', title: 'Test', path: '/test.md' })

      expect(emitSpy).toHaveBeenCalledWith({ type: 'nav:recents-changed' })
    })

    it('does not emit on non-ok response', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents' && init?.method === 'POST',
          response: () => jsonResponse({}, 500),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      await addToNavHistory({ id: 'doc:test', type: 'doc', title: 'Test' })

      expect(emitSpy).not.toHaveBeenCalled()
    })

    it('does not emit on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      await addToNavHistory({ id: 'doc:test', type: 'doc', title: 'Test' })

      expect(emitSpy).not.toHaveBeenCalled()
    })
  })

  describe('removeFromNavHistory', () => {
    it('deletes by id and emits recents-changed on success', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url.startsWith('/api/nav/recents?id=') && init?.method === 'DELETE',
          response: () => jsonResponse({ ok: true }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      await removeFromNavHistory('doc:test')

      expect(mockFetch).toHaveBeenCalledWith('/api/nav/recents?id=doc%3Atest', { method: 'DELETE' })
      expect(emitSpy).toHaveBeenCalledWith({ type: 'nav:recents-changed' })
    })

    it('does not emit on non-ok response', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url.startsWith('/api/nav/recents?id=') && init?.method === 'DELETE',
          response: () => jsonResponse({}, 404),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      await removeFromNavHistory('doc:test')

      expect(emitSpy).not.toHaveBeenCalled()
    })

    it('does not emit on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      await removeFromNavHistory('doc:test')

      expect(emitSpy).not.toHaveBeenCalled()
    })
  })

  describe('clearNavHistory', () => {
    it('deletes all and emits recents-changed on success', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents?all=1' && init?.method === 'DELETE',
          response: () => jsonResponse({ ok: true }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      await clearNavHistory()

      expect(mockFetch).toHaveBeenCalledWith('/api/nav/recents?all=1', { method: 'DELETE' })
      expect(emitSpy).toHaveBeenCalledWith({ type: 'nav:recents-changed' })
    })

    it('does not emit on non-ok response', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents?all=1' && init?.method === 'DELETE',
          response: () => jsonResponse({}, 500),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      await clearNavHistory()

      expect(emitSpy).not.toHaveBeenCalled()
    })

    it('does not emit on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      await clearNavHistory()

      expect(emitSpy).not.toHaveBeenCalled()
    })
  })

  describe('upsertEmailNavHistory', () => {
    it('posts email data and returns true when updated', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents/upsert-email' && init?.method === 'POST',
          response: () => jsonResponse({ updated: true }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const result = await upsertEmailNavHistory('thread-1', 'Subject Line', 'sender@example.com')

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith('/api/nav/recents/upsert-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId: 'thread-1', subject: 'Subject Line', from: 'sender@example.com' }),
      })
      expect(emitSpy).toHaveBeenCalledWith({ type: 'nav:recents-changed' })
    })

    it('returns false and does not emit when not updated', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents/upsert-email' && init?.method === 'POST',
          response: () => jsonResponse({ updated: false }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const result = await upsertEmailNavHistory('thread-1', 'Subject Line', 'sender@example.com')

      expect(result).toBe(false)
      expect(emitSpy).not.toHaveBeenCalled()
    })

    it('returns false on non-ok response', async () => {
      const mockFetch = createMockFetch([
        {
          match: (url, init) => url === '/api/nav/recents/upsert-email' && init?.method === 'POST',
          response: () => jsonResponse({}, 500),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      const result = await upsertEmailNavHistory('thread-1', 'Subject', 'from@test.com')

      expect(result).toBe(false)
      expect(emitSpy).not.toHaveBeenCalled()
    })

    it('returns false on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const result = await upsertEmailNavHistory('thread-1', 'Subject', 'from@test.com')

      expect(result).toBe(false)
      expect(emitSpy).not.toHaveBeenCalled()
    })
  })
})
