/**
 * Hono is not one of the Node agent's first-class instrumented web frameworks, so
 * the HTTP entry often ends up with a single catch-all (e.g. `*`) in APM. This
 * middleware runs after routing completes and renames the current NR transaction
 * to `METHOD <route pattern>` (e.g. `GET /api/chat/sessions/:sessionId`) using
 * Hono's registered path, not the literal URL.
 *
 * @see https://hono.dev/docs/api/request#routepath (via `hono/route`)
 * @see newrelic.setTransactionName in the New Relic Node.js agent API
 */
import type { Context, MiddlewareHandler } from 'hono'
import { matchedRoutes, routePath } from 'hono/route'
import newrelic from 'newrelic'

function buildTransactionLabel(c: Context): string {
  const method = c.req.method
  const pattern = routePath(c) || matchedRoutes(c).at(c.req.routeIndex)?.path || ''
  if (pattern && pattern !== '*' && pattern !== '/*') {
    return `${method} ${pattern}`
  }
  // Wildcard or unknown: keep cardinality low. API requests should still match a real pattern above.
  if (c.req.path.startsWith('/api/')) {
    const parts = c.req.path.split('/').filter(Boolean)
    const prefix = parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : c.req.path
    return `${method} ${prefix}/* (unlabeled)`
  }
  if (/\.[A-Za-z0-9]{1,8}$/.test(c.req.path)) {
    return `${method} (static file)`
  }
  if (c.req.path === '/' || c.req.path === '') {
    return `${method} (web /)`
  }
  return `${method} (web /*)`
}

export function newRelicHonoTransactionMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    try {
      await next()
    } finally {
      newrelic.setTransactionName(buildTransactionLabel(c))
    }
  }
}
