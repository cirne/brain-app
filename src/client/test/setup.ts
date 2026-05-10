/**
 * Vitest setup for the **client** project only (jsdom). See vitest.config.ts `projects`.
 */
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/svelte'
import { afterEach, vi } from 'vitest'

import { initI18n, setLanguage } from '@client/lib/i18n/index.js'
import {
  backgroundAgentsFromEvents,
  yourWikiDocFromEvents,
} from '@client/lib/hubEvents/hubEventsStores.js'

await initI18n({ forceLanguage: 'en' })
await setLanguage('en')

afterEach(() => {
  cleanup()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.useRealTimers()
})

afterEach(() => {
  yourWikiDocFromEvents.set(null)
  backgroundAgentsFromEvents.set([])
})

const matchMediaImpl = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation(matchMediaImpl),
})
