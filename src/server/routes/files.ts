/**
 * Read raw files on disk via ripmail (same extraction as CLI `ripmail read <path> --json --full-body`).
 * Not for wiki markdown — use `/api/wiki` for Brain wiki pages.
 */
import { existsSync, statSync } from 'node:fs'
import { Hono } from 'hono'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { ripmailReadExecOptions } from '@server/lib/ripmail/ripmailReadExec.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import {
  buildReadPathAllowlist,
  expandRawPathToAbsolute,
  isAgentReadPathAllowed,
} from '@server/lib/chat/agentPathPolicy.js'

const files = new Hono()

// GET /api/files/read?path= — JSON from `ripmail read <path> --json --full-body`
files.get('/read', async c => {
  const raw = c.req.query('path')
  if (!raw?.trim()) {
    return c.json({ error: 'missing path' }, 400)
  }
  const fullPath = expandRawPathToAbsolute(raw)
  const allow = await buildReadPathAllowlist()
  if (!isAgentReadPathAllowed(fullPath, allow)) {
    return c.json({ error: 'path not allowed for this tenant' }, 403)
  }
  if (!existsSync(fullPath)) {
    return c.json({ error: 'Not found' }, 404)
  }
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(fullPath)
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
  if (!st.isFile()) {
    return c.json({ error: 'Not a file' }, 400)
  }

  const rm = ripmailBin()
  try {
    const { stdout, stderr } = await execRipmailAsync(
      `${rm} read ${JSON.stringify(fullPath)} --json --full-body`,
      {
        ...ripmailReadExecOptions(),
      },
    )
    if (stderr?.trim()) {
      console.warn('[api/files/read] ripmail stderr:', stderr.slice(0, 500))
    }
    const trimmed = stdout.trim()
    if (!trimmed) {
      return c.json({ error: 'empty output from ripmail' }, 502)
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      return c.json(parsed)
    } catch {
      return c.json({ error: 'invalid JSON from ripmail', raw: trimmed.slice(0, 200) }, 502)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/files/read]', msg)
    return c.json({ error: msg }, 500)
  }
})

export default files
