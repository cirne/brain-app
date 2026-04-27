// New Relic APM: must load before any other application code.
import 'newrelic'
// Load .env in dev, overriding existing vars (important: parent shell may
// set ANTHROPIC_API_KEY to empty, and loadEnvFile won't override it).
import { loadDotEnv } from '@server/lib/platform/loadDotEnv.js'
import { Hono } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serve, getRequestListener } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { logger } from 'hono/logger'
import { getCookie } from 'hono/cookie'
import { createServer } from 'node:http'
import chatRoute from './routes/chat.js'
import skillsRoute from './routes/skills.js'
import wikiRoute from './routes/wiki.js'
import filesRoute from './routes/files.js'
import inboxRoute from './routes/inbox.js'
import calendarRoute from './routes/calendar.js'
import searchRoute from './routes/search.js'
import imessageRoute from './routes/imessage.js'
import onboardingRoute from './routes/onboarding.js'
import backgroundRoute from './routes/background.js'
import yourWikiRoute from './routes/yourWiki.js'
import gmailOAuthRoute from './routes/gmailOAuth.js'
import demoEnronAuthRoute from './routes/demoEnronAuth.js'
import { ENRON_DEMO_SEED_STATUS_PATH } from '@server/lib/auth/enronDemo.js'
import navRecentsRoute from './routes/navRecents.js'
import oauthGoogleBrowserPages from './routes/oauthGoogleBrowserPages.js'
import issuesRoute from './routes/issues.js'
import hubRoute from './routes/hub.js'
import hubEventsRoute from './routes/hubEvents.js'
import devRoute from './routes/dev.js'
import vaultRoute from './routes/vault.js'
import accountRoute from './routes/account.js'
import transcribeRoute from './routes/transcribe.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { ensureYourWikiRunning, requestLapNow } from './agent/yourWikiSupervisor.js'
import { initLocalMessageToolsAvailability } from '@server/lib/apple/imessageDb.js'
import { runStartupChecks } from '@server/lib/platform/runStartupChecks.js'
import { ensureBrainHomeGitignore } from '@server/lib/platform/brainHomeGitignore.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { runSplitLayoutMigrationIfNeeded } from '@server/lib/onboarding/splitLayoutMigration.js'
import { runFullSync, getSyncIntervalMs } from '@server/lib/platform/syncAll.js'
import { terminateAllTrackedRipmailChildren } from '@server/lib/ripmail/ripmailExec.js'
import debugRipmailChildrenRoute from './routes/debugRipmailChildren.js'
import {
  startRipmailBackfillSupervisor,
  stopRipmailBackfillSupervisor,
} from '@server/lib/ripmail/ripmailBackfillSupervisor.js'
import { startTunnel, stopTunnel, getActiveTunnelUrl, getHostGuid } from '@server/lib/platform/tunnelManager.js'
import { readOnboardingPreferences } from '@server/lib/onboarding/onboardingPreferences.js'
import { BRAIN_DEFAULT_HTTP_PORT, setActualNativePort } from '@server/lib/platform/brainHttpPort.js'
import { isAllowedBundledNativeClientIp } from '@server/lib/platform/bundledNativeClientAllowlist.js'
import { isBundledNativeServer, nativeAppOAuthPortCandidates } from '@server/lib/apple/nativeAppPort.js'
import {
  duplicateDevListenMessage,
  isAddrInUse,
  probeDevPortAvailable,
} from '@server/lib/platform/devServerDuplicatePort.js'
import { newRelicBrainContextMiddleware } from '@server/lib/observability/newRelicBrainContextMiddleware.js'
import { newRelicHonoTransactionMiddleware } from '@server/lib/observability/newRelicHonoTransaction.js'
import { fileURLToPath } from 'node:url'
import { setPromptsRoot } from '@server/lib/prompts/registry.js'

loadDotEnv()
setPromptsRoot(fileURLToPath(new URL('./prompts', import.meta.url)))

const app = new Hono()
// Names NR web transactions from Hono's matched route pattern (not Express-style auto naming).
app.use('*', newRelicHonoTransactionMiddleware())
const isDev = process.env.NODE_ENV !== 'production'

if (isBundledNativeServer()) {
  app.use('*', async (c, next) => {
    const prefs = await readOnboardingPreferences()
    if (prefs.allowLanDirectAccess === true) {
      return next()
    }
    let addr: string | undefined
    try {
      addr = getConnInfo(c).remote.address
    } catch {
      addr = undefined
    }
    if (addr === undefined) {
      const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } }).incoming
      addr = incoming?.socket?.remoteAddress
    }
    if (!isAllowedBundledNativeClientIp(addr)) {
      return c.text('Forbidden', 403)
    }
    return next()
  })
}

// Global middleware to enforce Host GUID protection for tunnel traffic
// (This is redundant in dev mode as it's handled in createServer, but kept for prod/native)
app.use('*', async (c, next) => {
  const tunnelUrl = getActiveTunnelUrl()
  if (!tunnelUrl) return next()

  // Only enforce Magic GUID on the named host (predictable URL). Quick Tunnels
  // (trycloudflare.com) rely on the ephemeral hostname as the secret.
  const host = c.req.header('host')
  if (host && host.includes('brain.chatdnd.io')) {
    const guid = getHostGuid()
    const providedGuid = c.req.query('g')

    // Check for GUID in query or in a cookie (for subsequent requests)
    const cookieGuid = getCookie(c, 'brain_g')
    
    if (providedGuid === guid) {
      // Valid GUID provided, set a long-lived cookie and proceed
      // Use Secure and SameSite=None for tunnel compatibility
      c.header('Set-Cookie', `brain_g=${guid}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=31536000`, { append: true })
      
      // If this is a top-level document request, redirect to strip the GUID
      if (c.req.header('accept')?.includes('text/html') && !c.req.path.startsWith('/api/')) {
        const url = new URL(c.req.url)
        url.searchParams.delete('g')
        // Use 302 to ensure the browser doesn't cache the redirect without the cookie
        return c.redirect(url.toString(), 302)
      }
      return next()
    }

    if (cookieGuid === guid) {
      return next()
    }

    return c.text('Unauthorized: Invalid or missing Magic GUID', 401)
  }
  
  return next()
})

app.use('/api/*', tenantMiddleware)
app.use('/api/*', newRelicBrainContextMiddleware())
app.use('/api/*', vaultGateMiddleware)

const requestLogger = logger()
/** High-frequency onboarding polls — skip Hono access logs to reduce noise */
function isQuietPollPath(path: string): boolean {
  return (
    path === '/api/onboarding/mail' ||
    path === '/api/inbox/mail-sync-status' ||
    path === '/api/onboarding/ripmail' ||
    path === '/api/oauth/google/last-result' ||
    path === '/api/hub/sources' ||
    path === '/api/vault/status' ||
    path === ENRON_DEMO_SEED_STATUS_PATH ||
    path === '/api/events'
  )
}
app.use('*', async (c, next) => {
  if (isQuietPollPath(c.req.path)) return next()
  return requestLogger(c, next)
})

app.route('/api/vault', vaultRoute)
app.route('/api/account', accountRoute)
app.route('/api/chat', chatRoute)
app.route('/api/transcribe', transcribeRoute)
app.route('/api/skills', skillsRoute)
app.route('/api/issues', issuesRoute)
app.route('/api/wiki', wikiRoute)
app.route('/api/files', filesRoute)
app.route('/api/inbox', inboxRoute)
app.route('/api/calendar', calendarRoute)
app.route('/api/search', searchRoute)
app.route('/api/imessage', imessageRoute)
app.route('/api/messages', imessageRoute)
app.route('/api/onboarding', onboardingRoute)
app.route('/api/hub', hubRoute)
app.route('/api/events', hubEventsRoute)
app.route('/api/background', backgroundRoute)
app.route('/api/your-wiki', yourWikiRoute)
app.route('/api/oauth/google', gmailOAuthRoute)
app.route('/api/auth/demo', demoEnronAuthRoute)
app.route('/api/nav/recents', navRecentsRoute)
app.route('/oauth/google', oauthGoogleBrowserPages)
if (isDev) {
  app.route('/api/dev', devRoute)
}
if (isDev || process.env.BRAIN_DEBUG_CHILDREN === '1') {
  app.route('/api/debug', debugRipmailChildrenRoute)
}

let shuttingDown = false
let syncTimer: ReturnType<typeof setInterval> | undefined

function registerPeriodicSyncAndShutdown(server: { close: (cb?: (err?: Error) => void) => void }) {
  if (!isMultiTenantMode()) {
    const intervalMs = getSyncIntervalMs()
    syncTimer = setInterval(() => {
      if (shuttingDown) return
      void (async () => {
        try {
          await runFullSync()
          // Wake the wiki supervisor after each sync so it can pick up new mail-sourced content.
          requestLapNow()
        } catch (e) {
          console.error('[brain-app] periodic sync error:', e)
        }
      })()
    }, intervalMs)

    // Start the Your Wiki continuous loop (idempotent; respects persisted pause state).
    void ensureYourWikiRunning().catch((e) => {
      console.error('[your-wiki] startup error:', e)
    })

    startRipmailBackfillSupervisor()
  }

  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    if (syncTimer !== undefined) {
      clearInterval(syncTimer)
      syncTimer = undefined
    }
    if (!isMultiTenantMode()) {
      stopRipmailBackfillSupervisor()
    }
    stopTunnel()
    terminateAllTrackedRipmailChildren('SIGTERM')
    await new Promise((r) => setTimeout(r, 2000))
    terminateAllTrackedRipmailChildren('SIGKILL')
    server.close(() => {
      process.exit(0)
    })
    setTimeout(() => process.exit(0), 30_000).unref()
  }

  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}

function resolveNonNativePort(): number {
  return parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)
}

/**
 * Try to bind an `http`/`https` server to a single port. Returns true on success, false on EADDRINUSE,
 * throws on any other error.
 */
function tryListen(server: ServerType, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onErr = (err: Error & { code?: string }) => {
      server.removeListener('error', onErr)
      if (err.code === 'EADDRINUSE') {
        resolve(false)
      } else {
        reject(err)
      }
    }
    server.once('error', onErr)
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', onErr)
      resolve(true)
    })
  })
}

/**
 * Bundled Tauri app: bind the first available port from the OAuth candidate list
 * (18473, 18474, 18475, 18476). Multiple users on the same machine each get their own port.
 * HTTP (cleartext) for now; optional TLS under `$BRAIN_HOME/var` is tracked in OPP-036.
 * Calls {@link setActualNativePort} so the OAuth redirect URI reflects the bound port.
 */
async function listenNativeBundled(): Promise<ServerType> {
  const candidates = nativeAppOAuthPortCandidates()
  const handler = getRequestListener(app.fetch)

  for (const p of candidates) {
    const server = createServer(handler) as ServerType
    const bound = await tryListen(server, p)
    if (bound) {
      setActualNativePort(p)
      // Tauri reads this line to navigate the webview; do not remove or prefix with other text.
      console.log(`BRAIN_LISTEN_PORT=${p}`)
      if (p !== candidates[0]) {
        console.log(`[brain-app] Port ${candidates[0]} in use; bound to fallback port ${p}`)
      }
      console.log(
        `[brain-app] Bundled server listening on 0.0.0.0:${p} (HTTP; Tailscale: http://<this-machine-tailscale-ip>:${p}; OAuth: http://127.0.0.1:${p})`,
      )
      return server
    }
    server.close(() => {})
  }

  throw new Error(
    `[brain-app] All OAuth ports in use (${candidates.join(', ')}). Stop another Braintunnel instance or free one of these ports.`,
  )
}

async function start() {
  try {
    initLocalMessageToolsAvailability()
    if (!isMultiTenantMode()) {
      await runSplitLayoutMigrationIfNeeded()
      await ensureBrainHomeGitignore()
    } else {
      // One-time: legacy handle dirs → `usr_*`; registry normalization. Remove after deploy confirms (see module).
      const { migrateTenantDirsToUserIdOnce } = await import(
        '@server/lib/tenant/migrateTenantDirsToUserId.js'
      )
      await migrateTenantDirsToUserIdOnce()
    }

    // Inline NODE_ENV check so production bundles can drop the Vite branch (see esbuild define).
    if (process.env.NODE_ENV !== 'production') {
      const port = resolveNonNativePort()
      // If another `npm run dev` already owns this port, exit before createViteServer — otherwise Vite
      // would still start a second HMR WebSocket (e.g. :24678) and fight the first dev server.
      const portFree = await probeDevPortAvailable(port)
      if (!portFree) {
        console.error(duplicateDevListenMessage(port))
        process.exit(1)
        return
      }

      // In dev: Vite runs as middleware inside the same server.
      // API requests go to Hono; everything else goes to Vite (HMR included).
      const { createServer: createViteServer } = await import('vite')
      const vite = await createViteServer({
        configFile: 'vite.config.ts',
        server: { 
          middlewareMode: true,
          hmr: {
            clientPort: port
          }
        },
        appType: 'spa',
      })

      const honoHandler = getRequestListener(app.fetch)
      const server = createServer((req, res) => {
        const tunnelUrl = getActiveTunnelUrl()
        const host = req.headers['host']
        const needsNamedTunnelGuid = host && host.includes('brain.chatdnd.io')

        if (tunnelUrl && needsNamedTunnelGuid) {
          const url = new URL(req.url ?? '/', `http://${host}`)
          const providedGuid = url.searchParams.get('g')
          const guid = getHostGuid()
          
          // Simple cookie parser for the raw header
          const cookies = req.headers['cookie'] ?? ''
          const cookieMatch = cookies.match(/brain_g=([^;]+)/)
          const cookieGuid = cookieMatch ? cookieMatch[1] : null

          if (providedGuid === guid) {
            // Valid GUID provided, set a long-lived cookie and proceed
            res.setHeader('Set-Cookie', `brain_g=${guid}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=31536000`)
            
            // If this is a top-level document request, redirect to strip the GUID
            const accept = req.headers['accept'] ?? ''
            if (accept.includes('text/html') && !req.url?.startsWith('/api/')) {
              url.searchParams.delete('g')
              res.writeHead(302, { Location: url.toString() })
              res.end()
              return
            }
          } else if (cookieGuid !== guid) {
            res.writeHead(401, { 'Content-Type': 'text/plain' })
            res.end('Unauthorized: Invalid or missing Magic GUID')
            return
          }
        }

        if (req.url?.startsWith('/api/')) {
          honoHandler(req, res)
        } else {
          vite.middlewares(req, res, () => {
            res.statusCode = 404
            res.end()
          })
        }
      })

      server.once('error', (err: unknown) => {
        if (isAddrInUse(err)) {
          console.error(duplicateDevListenMessage(port))
          void vite
            .close()
            .then(() => process.exit(1))
            .catch(() => process.exit(1))
          return
        }
        console.error(err)
        process.exit(1)
      })

      server.listen(port, '0.0.0.0', () => {
        console.log(`Dev server (Hono + Vite HMR) → http://localhost:${port}`)
        registerPeriodicSyncAndShutdown(server)
        void runStartupChecks(port)
        void (async () => {
          const prefs = await readOnboardingPreferences()
          if (prefs.remoteAccessEnabled) {
            void startTunnel(port)
          }
        })()
      })
    } else {
      // In production: serve pre-built client from dist/client
      app.use('*', serveStatic({ root: './dist/client' }))
      app.get('*', serveStatic({ path: './dist/client/index.html' }))

      if (isBundledNativeServer()) {
        const server = await listenNativeBundled()
        registerPeriodicSyncAndShutdown(server)
        const addr = server.address()
        const listenPort =
          typeof addr === 'object' && addr !== null ? addr.port : undefined
        void runStartupChecks(listenPort)
        if (listenPort) {
          void (async () => {
            const prefs = await readOnboardingPreferences()
            if (prefs.remoteAccessEnabled) {
              void startTunnel(listenPort)
            }
          })()
        }
      } else {
        const port = resolveNonNativePort()
        const server = serve({ fetch: app.fetch, port }, () => {
          console.log(`Server running on http://localhost:${port}`)
          registerPeriodicSyncAndShutdown(server)
          void runStartupChecks(port)
          void (async () => {
            const prefs = await readOnboardingPreferences()
            if (prefs.remoteAccessEnabled) {
              void startTunnel(port)
            }
          })()
        })
      }
    }
  } catch (e) {
    console.error(e)
    process.exitCode = 1
    process.exit(1)
  }
}

void start().catch((e) => {
  console.error(e)
  process.exitCode = 1
  process.exit(1)
})
