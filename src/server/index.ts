// Load .env in dev, overriding existing vars (important: parent shell may
// set ANTHROPIC_API_KEY to empty, and loadEnvFile won't override it).
import { loadDotEnv } from './lib/loadDotEnv.js'
import { Hono } from 'hono'
import { serve, getRequestListener } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { basicAuth } from 'hono/basic-auth'
import { logger } from 'hono/logger'
import { createServer } from 'node:http'
import chatRoute from './routes/chat.js'
import wikiRoute from './routes/wiki.js'
import inboxRoute from './routes/inbox.js'
import calendarRoute from './routes/calendar.js'
import searchRoute from './routes/search.js'
import imessageRoute from './routes/imessage.js'
import onboardingRoute from './routes/onboarding.js'
import devRoute from './routes/dev.js'
import { logStartupDiagnostics } from './lib/startupDiagnostics.js'
import { initImessageToolsAvailability } from './lib/imessageDb.js'
import { verifyLlmAtStartup } from './lib/llmStartupSmoke.js'
import { runFullSync, getSyncIntervalMs } from './lib/syncAll.js'

loadDotEnv()

const app = new Hono()
const isDev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT ?? '3000')

const requestLogger = logger()
/** High-frequency onboarding polls — skip Hono access logs to reduce noise */
function isQuietPollPath(path: string): boolean {
  return path === '/api/onboarding/mail' || path === '/api/onboarding/ripmail'
}
app.use('*', async (c, next) => {
  if (isQuietPollPath(c.req.path)) return next()
  return requestLogger(c, next)
})

// Auth: required in production unless AUTH_DISABLED=true (e.g. private subnet)
if (!isDev && process.env.AUTH_DISABLED !== 'true') {
  app.use('/api/*', basicAuth({
    username: process.env.AUTH_USER ?? 'lew',
    password: process.env.AUTH_PASS ?? 'changeme',
  }))
}

app.route('/api/chat', chatRoute)
app.route('/api/wiki', wikiRoute)
app.route('/api/inbox', inboxRoute)
app.route('/api/calendar', calendarRoute)
app.route('/api/search', searchRoute)
app.route('/api/imessage', imessageRoute)
app.route('/api/onboarding', onboardingRoute)
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

async function start() {
  try {
    initImessageToolsAvailability()
    await verifyLlmAtStartup()
    await logStartupDiagnostics()

    if (isDev) {
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

      server.listen(port, () => {
        console.log(`Dev server (Hono + Vite HMR) → http://localhost:${port}`)
        registerPeriodicSyncAndShutdown(server)
      })
    } else {
      // In production: serve pre-built client from dist/client
      app.use('*', serveStatic({ root: './dist/client' }))
      app.get('*', serveStatic({ path: './dist/client/index.html' }))
      const server = serve({ fetch: app.fetch, port }, () => {
        console.log(`Server running on http://localhost:${port}`)
        registerPeriodicSyncAndShutdown(server)
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
