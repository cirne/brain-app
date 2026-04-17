// Load .env in dev, overriding existing vars (important: parent shell may
// set ANTHROPIC_API_KEY to empty, and loadEnvFile won't override it).
import { loadDotEnv } from './lib/loadDotEnv.js'
import { Hono } from 'hono'
import { createAdaptorServer, serve, getRequestListener } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { basicAuth } from 'hono/basic-auth'
import { logger } from 'hono/logger'
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
import gmailOAuthRoute from './routes/gmailOAuth.js'
import devRoute from './routes/dev.js'
import { initLocalMessageToolsAvailability } from './lib/imessageDb.js'
import { runStartupChecks } from './lib/runStartupChecks.js'
import { ensureBrainHomeGitignore } from './lib/brainHomeGitignore.js'
import { ensureDefaultSkillsSeeded } from './lib/skillsSeeder.js'
import { runFullSync, getSyncIntervalMs } from './lib/syncAll.js'
import { isBundledNativeServer, NATIVE_APP_PORT_START } from './lib/nativeAppPort.js'
import {
  duplicateDevListenMessage,
  isAddrInUse,
  probeDevPortAvailable,
} from './lib/devServerDuplicatePort.js'

loadDotEnv()

const app = new Hono()
const isDev = process.env.NODE_ENV !== 'production'

const requestLogger = logger()
/** High-frequency onboarding polls — skip Hono access logs to reduce noise */
function isQuietPollPath(path: string): boolean {
  return path === '/api/onboarding/mail' || path === '/api/onboarding/ripmail'
}
app.use('*', async (c, next) => {
  if (isQuietPollPath(c.req.path)) return next()
  return requestLogger(c, next)
})

// Auth: required in production unless AUTH_DISABLED=true (e.g. private subnet).
// Google OAuth callback must be reachable without browser basic auth.
if (!isDev && process.env.AUTH_DISABLED !== 'true') {
  const apiBasicAuth = basicAuth({
    username: process.env.AUTH_USER ?? 'lew',
    password: process.env.AUTH_PASS ?? 'changeme',
  })
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/oauth/google')) return next()
    return apiBasicAuth(c, next)
  })
}

app.route('/api/chat', chatRoute)
app.route('/api/skills', skillsRoute)
app.route('/api/wiki', wikiRoute)
app.route('/api/files', filesRoute)
app.route('/api/inbox', inboxRoute)
app.route('/api/calendar', calendarRoute)
app.route('/api/search', searchRoute)
app.route('/api/imessage', imessageRoute)
app.route('/api/messages', imessageRoute)
app.route('/api/onboarding', onboardingRoute)
app.route('/api/oauth/google', gmailOAuthRoute)
if (isDev) {
  app.route('/api/dev', devRoute)
}

let shuttingDown = false
let syncTimer: ReturnType<typeof setInterval> | undefined

function registerPeriodicSyncAndShutdown(server: { close: (cb?: (err?: Error) => void) => void }) {
  const intervalMs = getSyncIntervalMs()
  syncTimer = setInterval(() => {
    if (shuttingDown) return
    void (async () => {
      try {
        await runFullSync()
      } catch (e) {
        console.error('[brain-app] periodic sync error:', e)
      }
    })()
  }, intervalMs)

  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    if (syncTimer !== undefined) {
      clearInterval(syncTimer)
      syncTimer = undefined
    }
    try {
      await runFullSync()
    } catch (e) {
      console.error('[brain-app] shutdown sync error:', e)
    }
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
  return parseInt(process.env.PORT ?? String(NATIVE_APP_PORT_START), 10)
}

/**
 * Bundled Tauri app: bind the canonical Brain port (same as OAuth redirect and `frontendDist`).
 * Fails if another process already owns this port (no silent fallback).
 */
async function listenNativeBundled(): Promise<ServerType> {
  const p = NATIVE_APP_PORT_START
  const server = createAdaptorServer({ fetch: app.fetch })
  try {
    await new Promise<void>((resolve, reject) => {
      const onErr = (err: Error & { code?: string }) => {
        server.removeListener('error', onErr)
        reject(err)
      }
      server.once('error', onErr)
      server.listen(p, () => {
        server.removeListener('error', onErr)
        resolve()
      })
    })
    console.log(`Server running on http://localhost:${p}`)
    return server
  } catch (e) {
    const err = e as Error & { code?: string }
    server.close(() => {})
    if (err.code === 'EADDRINUSE') {
      throw new Error(
        `[brain-app] Port ${p} is required (OAuth redirect + Tauri). Free 127.0.0.1:${p} or stop the other process using it.`,
      )
    }
    throw e
  }
}

async function start() {
  try {
    initLocalMessageToolsAvailability()
    await ensureBrainHomeGitignore()
    await ensureDefaultSkillsSeeded()

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
        server: { middlewareMode: true },
        appType: 'spa',
      })

      const honoHandler = getRequestListener(app.fetch)
      const server = createServer((req, res) => {
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

      server.listen(port, () => {
        console.log(`Dev server (Hono + Vite HMR) → http://localhost:${port}`)
        registerPeriodicSyncAndShutdown(server)
        void runStartupChecks(port)
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
      } else {
        const port = resolveNonNativePort()
        const server = serve({ fetch: app.fetch, port }, () => {
          console.log(`Server running on http://localhost:${port}`)
          registerPeriodicSyncAndShutdown(server)
          void runStartupChecks(port)
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
