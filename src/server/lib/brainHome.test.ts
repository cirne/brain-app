import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ripmailProcessEnv } from './brainHome.js'

describe('ripmailProcessEnv', () => {
  beforeEach(() => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    delete process.env.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID
    delete process.env.RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET
  })

  afterEach(() => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    delete process.env.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID
    delete process.env.RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET
  })

  it('maps GOOGLE_OAUTH_* to RIPMAIL_GOOGLE_OAUTH_* when ripmail vars unset', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'brain-id'
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'brain-secret'
    const e = ripmailProcessEnv()
    expect(e.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID).toBe('brain-id')
    expect(e.RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET).toBe('brain-secret')
  })

  it('does not override explicit RIPMAIL_GOOGLE_OAUTH_*', () => {
    process.env.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID = 'rip-id'
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'brain-id'
    const e = ripmailProcessEnv()
    expect(e.RIPMAIL_GOOGLE_OAUTH_CLIENT_ID).toBe('rip-id')
  })
})
