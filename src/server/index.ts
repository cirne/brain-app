// Load .env in dev, overriding existing vars (important: parent shell may
// set ANTHROPIC_API_KEY to empty, and loadEnvFile won't override it).
import { readFileSync } from 'node:fs'
try {
  const envContent = readFileSync('.env', 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (val) process.env[key] = val
    }
  }
} catch { /* no .env file */ }

import { Hono } from 'hono'
import { serve, getRequestListener } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { basicAuth } from 'hono/basic-auth'
import { logger } from 'hono/logger'
import { createServer } from 'node:http'
import chatRoute from './routes/chat.js'
import wikiRoute from './routes/wiki.js'
import inboxRoute from './routes/inbox.js'

const app = new Hono()
const isDev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT ?? '3000')

app.use('*', logger())

// Auth: required in production, skipped in dev (localhost only)
if (!isDev) {
  app.use('/api/*', basicAuth({
    username: process.env.AUTH_USER ?? 'lew',
    password: process.env.AUTH_PASS ?? 'changeme',
  }))
}

app.route('/api/chat', chatRoute)
app.route('/api/wiki', wikiRoute)
app.route('/api/inbox', inboxRoute)

async function start() {
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
    })
  } else {
    // In production: serve pre-built client from dist/client
    app.use('*', serveStatic({ root: './dist/client' }))
    app.get('*', serveStatic({ path: './dist/client/index.html' }))
    serve({ fetch: app.fetch, port }, () => {
      console.log(`Server running on http://localhost:${port}`)
    })
  }
}

start()
