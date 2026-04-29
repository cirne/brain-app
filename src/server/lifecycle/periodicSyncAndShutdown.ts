import { terminateAllTrackedRipmailChildren } from '@server/lib/ripmail/ripmailRun.js'
import {
  ensureYourWikiRunning,
  prepareWikiSupervisorShutdown,
  requestLapNow,
} from '@server/agent/yourWikiSupervisor.js'
import {
  startRipmailBackfillSupervisor,
  stopRipmailBackfillSupervisor,
} from '@server/lib/ripmail/ripmailBackfillSupervisor.js'
import { stopTunnel } from '@server/lib/platform/tunnelManager.js'
import { runFullSync, getSyncIntervalMs } from '@server/lib/platform/syncAll.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { restoreStdinForShell } from '@server/lib/platform/restoreStdinForShell.js'

let shuttingDown = false
let syncTimer: ReturnType<typeof setInterval> | undefined

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

  const forcedExitFromRepeatSignal = (): never => {
    restoreStdinForShell()
    process.exit(lastDrainSignal === 'SIGTERM' ? 143 : 130)
  }
  if (!isMultiTenantMode()) {
    const intervalMs = getSyncIntervalMs()
    syncTimer = setInterval(() => {
      if (shuttingDown) return
      void (async () => {
        try {
          await runFullSync()
          requestLapNow()
        } catch (e) {
          console.error('[brain-app] periodic sync error:', e)
        }
      })()
    }, intervalMs)

    void ensureYourWikiRunning().catch((e) => {
      console.error('[your-wiki] startup error:', e)
    })

    startRipmailBackfillSupervisor()
  }

  const shutdown = async () => {
    if (shuttingDown) forcedExitFromRepeatSignal()
    shuttingDown = true
    if (syncTimer !== undefined) {
      clearInterval(syncTimer)
      syncTimer = undefined
    }
    if (!isMultiTenantMode()) {
      stopRipmailBackfillSupervisor()
    }
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
