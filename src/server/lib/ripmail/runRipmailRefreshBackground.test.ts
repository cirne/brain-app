import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

vi.mock('@server/lib/ripmail/ripmailHeavySpawn.js', () => ({
  runRipmailRefreshForBrain: vi.fn(),
}))

import { runRipmailRefreshForBrain } from '@server/lib/ripmail/ripmailHeavySpawn.js'
import { runRipmailRefreshInBackground } from './runRipmailRefreshBackground.js'

describe('runRipmailRefreshInBackground', () => {
  beforeEach(() => {
    vi.mocked(runRipmailRefreshForBrain).mockReset()
    vi.mocked(runRipmailRefreshForBrain).mockRejectedValue(new Error('refresh failed'))
  })

  it('logs when background refresh rejects', async () => {
    const spy = vi.spyOn(brainLogger, 'error').mockImplementation(() => {})
    runRipmailRefreshInBackground('src1', 'ripmail refresh (background) failed')
    await Promise.resolve()
    await Promise.resolve()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
