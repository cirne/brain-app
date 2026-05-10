// New Relic APM: must load before any other application code.
import 'newrelic'
import '@server/lib/platform/loadDotEnvBootstrap.js'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { serve, getRequestListener } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { logger } from 'hono/logger'
import { createServer } from 'node:http'
import { shouldSuppressAccessLogForApiPath } from '@server/lib/auth/publicRoutePolicy.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { initLocalMessageToolsAvailability } from '@server/lib/apple/imessageDb.js'
import { runStartupChecks } from '@server/lib/platform/runStartupChecks.js'
import { startTunnel, getActiveTunnelUrl, getHostGuid } from '@server/lib/platform/tunnelManager.js'
import {
  BRAIN_TUNNEL_COOKIE_NAME,
  buildBrainTunnelGuidCookie,
  decideNamedTunnelGuidAccess,
  parseBrainTunnelCookie,
} from '@server/lib/platform/tunnelAuth.js'
import { readOnboardingPreferences } from '@server/lib/onboarding/onboardingPreferences.js'
import { BRAIN_DEFAULT_HTTP_PORT } from '@server/lib/platform/brainHttpPort.js'
import {
  duplicateDevListenMessage,
  isAddrInUse,
  probeDevPortAvailable,
} from '@server/lib/platform/devServerDuplicatePort.js'
import { newRelicBrainContextMiddleware } from '@server/lib/observability/newRelicBrainContextMiddleware.js'
import { newRelicHonoTransactionMiddleware } from '@server/lib/observability/newRelicHonoTransaction.js'
import { fileURLToPath } from 'node:url'
import { setPromptsRoot } from '@server/lib/prompts/registry.js'
import { executeVaultLogout, safeLogoutRedirectPath } from '@server/lib/vault/vaultLogoutCore.js'
import { registerPeriodicSyncAndShutdown } from './lifecycle/periodicSyncAndShutdown.js'
import { registerApiRoutes } from './registerApiRoutes.js'
import { isDevRuntime } from '@server/lib/platform/isDevRuntime.js'

import { registerDevTenantResetRoutes } from './routes/devTenantReset.js'

setPromptsRoot(fileURLToPath(new URL('./prompts', import.meta.url)))

const app = new Hono()
app.use('*', newRelicHonoTransactionMiddleware())
const isDev = isDevRuntime()

// Global middleware to enforce Host GUID protection for tunnel traffic
app.use('*', async (c, next) => {
  const guid = getHostGuid()
  const d = decideNamedTunnelGuidAccess({
    tunnelActive: Boolean(getActiveTunnelUrl()),
    hostHeader: c.req.header('host'),
    pathname: c.req.path,
    requestUrl: c.req.url,
    acceptHeader: c.req.header('accept'),
    queryParamG: c.req.query('g') ?? null,
    cookieBrainG: getCookie(c, BRAIN_TUNNEL_COOKIE_NAME),
    expectedGuid: guid,
  })
  switch (d.action) {
    case 'passthrough':
    case 'allow':
      return next()
    case 'allow_set_cookie': {
      c.header('Set-Cookie', buildBrainTunnelGuidCookie(guid), { append: true })
      if (d.redirectLocation) return c.redirect(d.redirectLocation, 302)
      return next()
    }
    case 'deny':
      return c.text('Unauthorized: Invalid or missing Magic GUID', 401)
    default:
      return next()
  }
})

/**
 * Browser-friendly sign-out: clears session and redirects to `/` (or `?next=/path`).
 */
app.get('/logout', async (c) => {
  const body = await executeVaultLogout(c)
  const accept = c.req.header('accept') ?? ''
  if (accept.includes('application/json')) {
    return c.json(body)
  }
  return c.redirect(safeLogoutRedirectPath(c.req.query('next')), 302)
})

if (isDev) {
  registerDevTenantResetRoutes(app)
}

app.use('/api/*', tenantMiddleware)
app.use('/api/*', newRelicBrainContextMiddleware())
app.use('/api/*', vaultGateMiddleware)

const requestLogger = logger()
app.use('*', async (c, next) => {
  if (shouldSuppressAccessLogForApiPath(c.req.path)) return next()
  return requestLogger(c, next)
})

registerApiRoutes(app, { isDev })

function resolveNonNativePort(): number {
  return parseInt(process.env.PORT ?? String(BRAIN_DEFAULT_HTTP_PORT), 10)
}

async function start() {
  try {
    initLocalMessageToolsAvailability()
    const { migrateTenantDirsToUserIdOnce } = await import(
      '@server/lib/tenant/migrateTenantDirsToUserId.js'
    )
    await migrateTenantDirsToUserIdOnce()

    if (process.env.NODE_ENV !== 'production') {
      const port = resolveNonNativePort()
      const portFree = await probeDevPortAvailable(port)
      if (!portFree) {
        console.error(duplicateDevListenMessage(port))
        process.exit(1)
        return
      }

      const { createServer: createViteServer } = await import('vite')
      const vite = await createViteServer({
        configFile: 'vite.config.ts',
        server: {
          middlewareMode: true,
          hmr: {
            clientPort: port,
          },
        },
        appType: 'spa',
      })

      const honoHandler = getRequestListener(app.fetch)
      const server = createServer((req, res) => {
        const tunnelUrl = getActiveTunnelUrl()
        const hostRaw = req.headers['host']
        const hostStr = typeof hostRaw === 'string' ? hostRaw : Array.isArray(hostRaw) ? hostRaw[0] : undefined

        let pathname: string
        let tunnelRequestUrl: string
        let queryParamG: string | null
        try {
          const u = new URL(req.url ?? '/', `http://${hostStr ?? 'localhost'}`)
          pathname = u.pathname
          tunnelRequestUrl = u.toString()
          queryParamG = u.searchParams.get('g')
        } catch {
          pathname = ''
          tunnelRequestUrl = req.url ?? '/'
          queryParamG = null
        }

        const guid = getHostGuid()
        const tunnelDecision = decideNamedTunnelGuidAccess({
          tunnelActive: Boolean(tunnelUrl),
          hostHeader: hostStr,
          pathname,
          requestUrl: tunnelRequestUrl,
          acceptHeader: typeof req.headers['accept'] === 'string' ? req.headers['accept'] : undefined,
          queryParamG,
          cookieBrainG: parseBrainTunnelCookie(
            typeof req.headers['cookie'] === 'string' ? req.headers['cookie'] : undefined,
          ),
          expectedGuid: guid,
        })

        if (tunnelDecision.action === 'allow_set_cookie') {
          res.setHeader('Set-Cookie', buildBrainTunnelGuidCookie(guid))
          if (tunnelDecision.redirectLocation) {
            res.writeHead(302, { Location: tunnelDecision.redirectLocation })
            res.end()
            return
          }
        } else if (tunnelDecision.action === 'deny') {
          res.writeHead(401, { 'Content-Type': 'text/plain' })
          res.end('Unauthorized: Invalid or missing Magic GUID')
          return
        }

        const devResetPath =
          pathname === '/reset' ||
          pathname === '/hard-reset' ||
          pathname === '/reset/' ||
          pathname === '/hard-reset/'
        /** OAuth “browser landing” HTML (`/oauth/google/complete`, `/error`) — must hit Hono, not Vite SPA. */
        const oauthGoogleBrowserPath = pathname === '/oauth/google' || pathname.startsWith('/oauth/google/')
        const useHono =
          Boolean(req.url?.startsWith('/api/')) ||
          (req.method === 'GET' && pathname === '/logout') ||
          (process.env.NODE_ENV !== 'production' && devResetPath) ||
          oauthGoogleBrowserPath
        if (useHono) {
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
        registerPeriodicSyncAndShutdown(server, vite)
        void runStartupChecks(port)
        void (async () => {
          const prefs = await readOnboardingPreferences()
          if (prefs.remoteAccessEnabled) {
            void startTunnel(port)
          }
        })()
      })
    } else {
      app.use('*', serveStatic({ root: './dist/client' }))
      app.get('*', serveStatic({ path: './dist/client/index.html' }))

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
