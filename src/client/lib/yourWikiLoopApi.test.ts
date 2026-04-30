import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { postYourWikiPause, postYourWikiResume } from './yourWikiLoopApi.js'

describe('yourWikiLoopApi', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))) as unknown as typeof fetch,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('postYourWikiPause POSTs pause endpoint', async () => {
    const fetchMock = vi.mocked(fetch)
    await postYourWikiPause()
    expect(fetchMock).toHaveBeenCalledWith('/api/your-wiki/pause', { method: 'POST' })
  })

  it('postYourWikiResume POSTs resume with local timezone', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'America/Los_Angeles',
    } as Intl.ResolvedDateTimeFormatOptions)

    const fetchMock = vi.mocked(fetch)
    await postYourWikiResume()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ timezone: 'America/Los_Angeles' })
  })
})
