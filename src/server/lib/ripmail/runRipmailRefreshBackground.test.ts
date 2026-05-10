import { beforeEach, describe, expect, it, vi } from 'vitest'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

vi.mock('@server/ripmail/sync/index.js', () => ({
  refresh: vi.fn(),
}))

import { refresh } from '@server/ripmail/sync/index.js'
import { runRipmailRefreshInBackground } from './runRipmailRefreshBackground.js'

describe('runRipmailRefreshInBackground', () => {
  beforeEach(() => {
    vi.mocked(refresh).mockReset()
    vi.mocked(refresh).mockRejectedValue(new Error('refresh failed'))
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
