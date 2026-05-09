import { terminateAllTrackedRipmailChildren } from '@server/lib/ripmail/ripmailRun.js'
import { prepareWikiSupervisorShutdown } from '@server/agent/yourWikiSupervisor.js'
import { stopTunnel } from '@server/lib/platform/tunnelManager.js'
import { restoreStdinForShell } from '@server/lib/platform/restoreStdinForShell.js'
import { startScheduledRipmailSync } from './scheduledRipmailSync.js'

let shuttingDown = false

/** Grace period after SIGTERM on ripmail children before SIGKILL (keep under tsx watch ~5s exit budget). */
const RIPMAIL_SHUTDOWN_GRACE_MS = 800

/** Bound `vite.close()` — it can stall on file watchers during interrupt. */
const VITE_SHUTDOWN_BUDGET_MS = 4500

export function registerPeriodicSyncAndShutdown(
  server: { close: (cb?: (err?: Error) => void) => void } & {
    closeAllConnections?: () => void
  },
  vite?: { close: () => Promise<void> },
): void {
  let lastDrainSignal: 'SIGINT' | 'SIGTERM' = 'SIGTERM'
  const stopScheduledRipmail = startScheduledRipmailSync()

  const forcedExitFromRepeatSignal = (): never => {
    restoreStdinForShell()
    process.exit(lastDrainSignal === 'SIGTERM' ? 143 : 130)
  }

  const shutdown = async () => {
    if (shuttingDown) forcedExitFromRepeatSignal()
    shuttingDown = true
    stopScheduledRipmail()
    stopTunnel()
    prepareWikiSupervisorShutdown()
    terminateAllTrackedRipmailChildren('SIGTERM')
    try {
      if (vite !== undefined) {
        await Promise.race([
          vite.close(),
          new Promise<void>((_, reject) => {
            setTimeout(
              () => reject(Object.assign(new Error('vite.shutdown.timeout'), { name: 'ViteShutdownTimeout' })),
              VITE_SHUTDOWN_BUDGET_MS,
            )
          }),
        ])
      }
    } catch {
      /* ignore */
    }
    server.closeAllConnections?.()
    await new Promise((r) => setTimeout(r, RIPMAIL_SHUTDOWN_GRACE_MS))
    terminateAllTrackedRipmailChildren('SIGKILL')
    server.close(() => {
      restoreStdinForShell()
      process.exit(0)
    })
    setTimeout(() => {
      restoreStdinForShell()
      process.exit(0)
    }, 30_000).unref()
  }

  process.on('SIGTERM', () => {
    lastDrainSignal = 'SIGTERM'
    void shutdown()
  })
  process.on('SIGINT', () => {
    lastDrainSignal = 'SIGINT'
    void shutdown()
  })
}
