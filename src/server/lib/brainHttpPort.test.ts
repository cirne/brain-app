import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BRAIN_DEFAULT_HTTP_PORT,
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleOAuthRedirectUri,
  oauthRedirectListenPort,
} from './brainHttpPort.js'
import { NATIVE_APP_PORT_START } from './nativeAppPort.js'

describe('brainHttpPort', () => {
  let savedPort: string | undefined
  let savedBundled: string | undefined

  beforeEach(() => {
    savedPort = process.env.PORT
    savedBundled = process.env.BRAIN_BUNDLED_NATIVE
    delete process.env.PORT
    delete process.env.BRAIN_BUNDLED_NATIVE
  })

  afterEach(() => {
    if (savedPort === undefined) delete process.env.PORT
    else process.env.PORT = savedPort
    if (savedBundled === undefined) delete process.env.BRAIN_BUNDLED_NATIVE
    else process.env.BRAIN_BUNDLED_NATIVE = savedBundled
  })

  it('default listen port is 3000 (dev / non-bundled), distinct from native app OAuth port', () => {
    expect(BRAIN_DEFAULT_HTTP_PORT).toBe(3000)
    expect(BRAIN_DEFAULT_HTTP_PORT).not.toBe(NATIVE_APP_PORT_START)
  })

  it('OAuth redirect follows PORT (or 3000) when not bundled', () => {
    expect(oauthRedirectListenPort()).toBe(3000)
    expect(googleOAuthRedirectUri()).toBe(
      `http://127.0.0.1:3000${GOOGLE_OAUTH_CALLBACK_PATH}`
    )
    process.env.PORT = '4001'
    expect(oauthRedirectListenPort()).toBe(4001)
    expect(googleOAuthRedirectUri()).toBe(
      `http://127.0.0.1:4001${GOOGLE_OAUTH_CALLBACK_PATH}`
    )
  })

  it('OAuth redirect uses native port when BRAIN_BUNDLED_NATIVE=1', () => {
    process.env.BRAIN_BUNDLED_NATIVE = '1'
    process.env.PORT = '9999'
    expect(oauthRedirectListenPort()).toBe(NATIVE_APP_PORT_START)
    expect(googleOAuthRedirectUri()).toBe(
      `http://127.0.0.1:${NATIVE_APP_PORT_START}${GOOGLE_OAUTH_CALLBACK_PATH}`
    )
  })
})
