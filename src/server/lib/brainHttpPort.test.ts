import { describe, it, expect } from 'vitest'
import {
  BRAIN_DEFAULT_HTTP_PORT,
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleOAuthRedirectUri,
} from './brainHttpPort.js'
import { NATIVE_APP_PORT_START } from './nativeAppPort.js'

describe('brainHttpPort', () => {
  it('OAuth redirect matches native default port and callback path', () => {
    expect(BRAIN_DEFAULT_HTTP_PORT).toBe(NATIVE_APP_PORT_START)
    expect(googleOAuthRedirectUri()).toBe(
      `http://127.0.0.1:${NATIVE_APP_PORT_START}${GOOGLE_OAUTH_CALLBACK_PATH}`
    )
  })
})
