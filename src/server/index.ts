// Load .env in dev (no-op in production where the file won't exist)
try { process.loadEnvFile() } catch { /* no .env file */ }

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { basicAuth } from 'hono/basic-auth'
import { logger } from 'hono/logger'
import chatRoute from './routes/chat.js'
import wikiRoute from './routes/wiki.js'
import inboxRoute from './routes/inbox.js'

const app = new Hono()

app.use('*', logger())

app.use(
  '*',
  basicAuth({
    username: process.env.AUTH_USER ?? 'lew',
    password: process.env.AUTH_PASS ?? 'changeme',
  })
)

app.route('/api/chat', chatRoute)
app.route('/api/wiki', wikiRoute)
app.route('/api/inbox', inboxRoute)

// Serve built client in production
app.use('*', serveStatic({ root: './dist/client' }))
app.get('*', serveStatic({ path: './dist/client/index.html' }))

const port = parseInt(process.env.PORT ?? '3000')
console.log(`Server running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
