import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BRAIN_DEFAULT_HTTP_PORT,
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleOAuthRedirectUri,
  oauthRedirectListenPort,
  setActualNativePort,
} from './brainHttpPort.js'
import { NATIVE_APP_PORT_START } from './nativeAppPort.js'

describe('brainHttpPort', () => {
  let savedPort: string | undefined
  let savedBundled: string | undefined
  let savedPublicWebOrigin: string | undefined

  beforeEach(() => {
    savedPort = process.env.PORT
    savedBundled = process.env.BRAIN_BUNDLED_NATIVE
    savedPublicWebOrigin = process.env.PUBLIC_WEB_ORIGIN
    delete process.env.PORT
    delete process.env.BRAIN_BUNDLED_NATIVE
    delete process.env.PUBLIC_WEB_ORIGIN
    // Reset dynamic port to the default before each test.
    setActualNativePort(NATIVE_APP_PORT_START)
  })

  afterEach(() => {
    if (savedPort === undefined) delete process.env.PORT
    else process.env.PORT = savedPort
    if (savedBundled === undefined) delete process.env.BRAIN_BUNDLED_NATIVE
    else process.env.BRAIN_BUNDLED_NATIVE = savedBundled
    if (savedPublicWebOrigin === undefined) delete process.env.PUBLIC_WEB_ORIGIN
    else process.env.PUBLIC_WEB_ORIGIN = savedPublicWebOrigin
    setActualNativePort(NATIVE_APP_PORT_START)
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

  it('OAuth redirect uses PUBLIC_WEB_ORIGIN when set (non-bundled)', () => {
    process.env.PUBLIC_WEB_ORIGIN = 'http://localhost:4000'
    expect(googleOAuthRedirectUri()).toBe(`http://localhost:4000${GOOGLE_OAUTH_CALLBACK_PATH}`)
    process.env.PUBLIC_WEB_ORIGIN = 'http://localhost:4000/'
    expect(googleOAuthRedirectUri()).toBe(`http://localhost:4000${GOOGLE_OAUTH_CALLBACK_PATH}`)
  })

  it('bundled mode ignores PUBLIC_WEB_ORIGIN', () => {
    process.env.BRAIN_BUNDLED_NATIVE = '1'
    process.env.PUBLIC_WEB_ORIGIN = 'http://evil.example'
    expect(googleOAuthRedirectUri()).toBe(
      `https://127.0.0.1:${NATIVE_APP_PORT_START}${GOOGLE_OAUTH_CALLBACK_PATH}`
    )
  })

  it('OAuth redirect uses actual native port (default 18473) when BRAIN_BUNDLED_NATIVE=1', () => {
    process.env.BRAIN_BUNDLED_NATIVE = '1'
    process.env.PORT = '9999' // PORT env is ignored in bundled mode
    expect(oauthRedirectListenPort()).toBe(NATIVE_APP_PORT_START)
    expect(googleOAuthRedirectUri()).toBe(
      `https://127.0.0.1:${NATIVE_APP_PORT_START}${GOOGLE_OAUTH_CALLBACK_PATH}`
    )
  })

  it('setActualNativePort updates the OAuth redirect URI in bundled mode', () => {
    process.env.BRAIN_BUNDLED_NATIVE = '1'
    const failoverPort = NATIVE_APP_PORT_START + 1
    setActualNativePort(failoverPort)
    expect(oauthRedirectListenPort()).toBe(failoverPort)
    expect(googleOAuthRedirectUri()).toBe(
      `https://127.0.0.1:${failoverPort}${GOOGLE_OAUTH_CALLBACK_PATH}`
    )
  })

  it('setActualNativePort has no effect when not in bundled mode', () => {
    setActualNativePort(NATIVE_APP_PORT_START + 2)
    // Non-bundled: PORT env drives the redirect, not the native port variable.
    expect(oauthRedirectListenPort()).toBe(3000)
  })

  it('BRAIN_LISTEN_PORT stdout line matches Tauri parser (desktop/src/server_spawn.rs)', () => {
    const line = `BRAIN_LISTEN_PORT=${NATIVE_APP_PORT_START + 1}\n`
    const m = /^BRAIN_LISTEN_PORT=(\d+)\s*$/.exec(line.trim())
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(NATIVE_APP_PORT_START + 1)
  })
})
