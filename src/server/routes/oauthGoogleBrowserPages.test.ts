import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import oauthGoogleBrowserPages from './oauthGoogleBrowserPages.js'
import { clearGoogleOauthDesktopResultForTests } from '../lib/googleOauthDesktopResult.js'

const app = new Hono()
app.route('/oauth/google', oauthGoogleBrowserPages)

beforeEach(() => {
  clearGoogleOauthDesktopResultForTests()
})
afterEach(() => {
  clearGoogleOauthDesktopResultForTests()
})

describe('GET /oauth/google/complete & /error', () => {
  it('serves HTML for complete', async () => {
    const res = await app.request('http://x/oauth/google/complete')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Gmail connected')
    expect(text).toContain('127.0.0.1')
  })

  it('serves HTML for error with escaped reason', async () => {
    const res = await app.request(
      'http://x/oauth/google/error?reason=' + encodeURIComponent('Bad <thing>')
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Bad &lt;thing&gt;')
    expect(text).not.toContain('<thing>')
  })
})
