import { timingSafeEqual } from 'node:crypto'
import type { Context } from 'hono'

/**
 * Bearer token for local operator / automation only (e.g. `BRAIN_EMBED_MASTER_KEY`). Not a public
 * internet auth story — see OPP-048.
 */
export function getBearerToken(c: Context): string | null {
  const h = c.req.header('Authorization')?.trim()
  if (!h || !h.toLowerCase().startsWith('bearer ')) return null
  const t = h.slice(7).trim()
  return t.length > 0 ? t : null
}

function secureStringEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** GET `/api/issues` or `/api/issues/:id` — may use embed key (OPP-048). */
export function isIssuesEmbedGetPath(path: string, method: string): boolean {
  if (method !== 'GET') return false
  if (path === '/api/issues' || path === '/api/issues/') return true
  return /^\/api\/issues\/[0-9]+\/?$/.test(path)
}

/** True when the request carries `Authorization: Bearer` equal to `process.env.BRAIN_EMBED_MASTER_KEY` (env must be non-empty). */
export function isValidEmbedKeyBearer(c: Context): boolean {
  const key = process.env.BRAIN_EMBED_MASTER_KEY?.trim()
  if (key == null || key.length === 0) return false
  const token = getBearerToken(c)
  if (token == null) return false
  return secureStringEqual(key, token)
}
