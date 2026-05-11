import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { runRipmailRepopulateChild } from './runRipmailRepopulateChild.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

type MockChild = EventEmitter & {
  pid?: number
  stderr: EventEmitter
}

function mockChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.pid = 12345
  child.stderr = new EventEmitter()
  return child
}

describe('runRipmailRepopulateChild', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('spawns the repopulate CLI and resolves on exit 0', async () => {
    const child = mockChild()
    vi.mocked(spawn).mockReturnValue(child as never)

    const logSpy = vi.spyOn(brainLogger, 'info').mockImplementation(() => undefined)
    try {
      const done = runRipmailRepopulateChild('/tmp/ripmail-home', {
        workspaceHandle: 'acme',
      })
      child.emit('close', 0, null)
      await expect(done).resolves.toBeUndefined()

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['/tmp/ripmail-home']),
        expect.objectContaining({
          env: process.env,
          stdio: ['ignore', 'inherit', 'pipe'],
        }),
      )
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ripmailHome: '/tmp/ripmail-home',
          workspaceHandle: 'acme',
          childPid: 12345,
        }),
        expect.stringContaining('child-start'),
      )
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ripmailHome: '/tmp/ripmail-home',
          workspaceHandle: 'acme',
          code: 0,
        }),
        expect.stringContaining('child-complete'),
      )
    } finally {
      logSpy.mockRestore()
    }
  })

  it('rejects with captured stderr on non-zero exit', async () => {
    const child = mockChild()
    vi.mocked(spawn).mockReturnValue(child as never)

    const warnSpy = vi.spyOn(brainLogger, 'warn').mockImplementation(() => undefined)
    try {
      const done = runRipmailRepopulateChild('/tmp/ripmail-home')
      child.stderr.emit('data', Buffer.from('boom\n'))
      child.emit('close', 1, null)

      await expect(done).rejects.toThrow('boom')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          ripmailHome: '/tmp/ripmail-home',
          code: 1,
          stderr: 'boom',
        }),
        expect.stringContaining('child-failed'),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
