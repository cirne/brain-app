import { Hono } from 'hono'

const app = new Hono()

/**
 * Lightweight client/embedded probes (`GET /api/config`). Some shells and integrations expect
 * this path; missing it returned 404 and could surface as a broken navigation or error UI.
 */
app.get('/', (c) =>
  c.json({
    ok: true as const,
    app: 'braintunnel' as const,
  }),
)

export default app
