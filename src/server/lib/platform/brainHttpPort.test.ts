import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  BRAIN_DEFAULT_HTTP_PORT,
  GOOGLE_OAUTH_CALLBACK_PATH,
  SLACK_OAUTH_CALLBACK_PATH,
  googleOAuthRedirectUri,
  oauthRedirectListenPort,
  slackOAuthRedirectUri,
} from './brainHttpPort.js'

describe('brainHttpPort', () => {
  let savedPort: string | undefined
  let savedPublicWebOrigin: string | undefined
  let savedNodeEnv: string | undefined

  beforeEach(() => {
    savedPort = process.env.PORT
    savedPublicWebOrigin = process.env.PUBLIC_WEB_ORIGIN
    savedNodeEnv = process.env.NODE_ENV
    delete process.env.PORT
    delete process.env.PUBLIC_WEB_ORIGIN
  })

  afterEach(() => {
    if (savedPort === undefined) delete process.env.PORT
    else process.env.PORT = savedPort
    if (savedPublicWebOrigin === undefined) delete process.env.PUBLIC_WEB_ORIGIN
    else process.env.PUBLIC_WEB_ORIGIN = savedPublicWebOrigin
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = savedNodeEnv
  })

  it('default listen port is 3000', () => {
    expect(BRAIN_DEFAULT_HTTP_PORT).toBe(3000)
  })

  it('Slack OAuth redirect follows PORT (or 3000)', () => {
    expect(slackOAuthRedirectUri()).toBe(`http://127.0.0.1:3000${SLACK_OAUTH_CALLBACK_PATH}`)
    process.env.PORT = '4001'
    expect(slackOAuthRedirectUri()).toBe(`http://127.0.0.1:4001${SLACK_OAUTH_CALLBACK_PATH}`)
    delete process.env.PORT
  })

  it('OAuth redirect follows PORT (or 3000)', () => {
    expect(oauthRedirectListenPort()).toBe(3000)
    expect(googleOAuthRedirectUri()).toBe(`http://127.0.0.1:3000${GOOGLE_OAUTH_CALLBACK_PATH}`)
    process.env.PORT = '4001'
    expect(oauthRedirectListenPort()).toBe(4001)
    expect(googleOAuthRedirectUri()).toBe(`http://127.0.0.1:4001${GOOGLE_OAUTH_CALLBACK_PATH}`)
  })

  it('OAuth redirect uses PUBLIC_WEB_ORIGIN when set', () => {
    process.env.PUBLIC_WEB_ORIGIN = 'http://localhost:4000'
    expect(googleOAuthRedirectUri()).toBe(`http://localhost:4000${GOOGLE_OAUTH_CALLBACK_PATH}`)
    process.env.PUBLIC_WEB_ORIGIN = 'http://localhost:4000/'
    expect(googleOAuthRedirectUri()).toBe(`http://localhost:4000${GOOGLE_OAUTH_CALLBACK_PATH}`)
  })

  it('OAuth redirect infers https origin from forwarded headers in production when PUBLIC_WEB_ORIGIN unset', async () => {
    process.env.NODE_ENV = 'production'
    const app = new Hono()
    app.get('/t', (c) => c.text(googleOAuthRedirectUri(c)))
    const res = await app.request('http://internal/t', {
      headers: {
        host: 'braintunnel-staging-zkpmz.ondigitalocean.app',
        'x-forwarded-proto': 'https',
      },
    })
    expect(await res.text()).toBe(
      `https://braintunnel-staging-zkpmz.ondigitalocean.app${GOOGLE_OAUTH_CALLBACK_PATH}`,
    )
  })

  it('OAuth redirect does not infer forwarded origin when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'test'
    const app = new Hono()
    app.get('/t', (c) => c.text(googleOAuthRedirectUri(c)))
    const res = await app.request('http://internal/t', {
      headers: {
        host: 'braintunnel-staging-zkpmz.ondigitalocean.app',
        'x-forwarded-proto': 'https',
      },
    })
    expect(await res.text()).toBe(`http://127.0.0.1:3000${GOOGLE_OAUTH_CALLBACK_PATH}`)
  })

  it('OAuth redirect prefers X-Forwarded-Host over Host when inferring', async () => {
    process.env.NODE_ENV = 'production'
    const app = new Hono()
    app.get('/t', (c) => c.text(googleOAuthRedirectUri(c)))
    const res = await app.request('http://10.0.0.1/t', {
      headers: {
        host: '10.0.0.1:8080',
        'x-forwarded-host': 'app.example.com',
        'x-forwarded-proto': 'https',
      },
    })
    expect(await res.text()).toBe(`https://app.example.com${GOOGLE_OAUTH_CALLBACK_PATH}`)
  })
})
