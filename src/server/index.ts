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
  const tunnelUrl = getActiveTunnelUrl()
  if (!tunnelUrl) return next()

  const host = c.req.header('host')
  if (host && host.includes('brain.chatdnd.io')) {
    const guid = getHostGuid()
    const providedGuid = c.req.query('g')

    const cookieGuid = getCookie(c, 'brain_g')

    if (providedGuid === guid) {
      c.header(
        'Set-Cookie',
        `brain_g=${guid}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=31536000`,
        { append: true },
      )

      if (c.req.header('accept')?.includes('text/html') && !c.req.path.startsWith('/api/')) {
        const url = new URL(c.req.url)
        url.searchParams.delete('g')
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
        const host = req.headers['host']
        const needsNamedTunnelGuid = host && host.includes('brain.chatdnd.io')

        if (tunnelUrl && needsNamedTunnelGuid) {
          const url = new URL(req.url ?? '/', `http://${host}`)
          const providedGuid = url.searchParams.get('g')
          const guid = getHostGuid()

          const cookies = req.headers['cookie'] ?? ''
          const cookieMatch = cookies.match(/brain_g=([^;]+)/)
          const cookieGuid = cookieMatch ? cookieMatch[1] : null

          if (providedGuid === guid) {
            res.setHeader(
              'Set-Cookie',
              `brain_g=${guid}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=31536000`,
            )

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

        const pathname = (() => {
          try {
            return new URL(req.url ?? '/', `http://${host ?? 'localhost'}`).pathname
          } catch {
            return ''
          }
        })()
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
