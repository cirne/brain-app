import { vi } from 'vitest'

import * as appEvents from '@client/lib/app/appEvents.js'

/** Spy `emit` with a no-op; cleared with other mocks in `setup.ts` `afterEach`. */
export function stubAppEventsEmit() {
  return vi.spyOn(appEvents, 'emit').mockImplementation(() => {})
}
