/**
 * Read raw files on disk via ripmail (same extraction as CLI `ripmail read <path> --json`).
 * Not for wiki markdown — use `/api/wiki` for Brain wiki pages.
 */
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { normalize, resolve } from 'node:path'
import { Hono } from 'hono'
import { execRipmailAsync } from '../lib/ripmailExec.js'
import { ripmailReadExecOptions } from '../lib/ripmailReadExec.js'
import { ripmailBin } from '../lib/ripmailBin.js'
import { isMultiTenantMode } from '../lib/dataRoot.js'
import { brainHome, ripmailHomeForBrain } from '../lib/brainHome.js'
import { isAbsolutePathAllowedUnderRoots } from '../lib/resolveTenantSafePath.js'

const files = new Hono()

function expandToAbsolute(raw: string): string {
  let p = raw.trim()
  if (p.startsWith('~/')) {
    p = resolve(homedir(), p.slice(2))
  } else {
    p = resolve(p)
  }
  return normalize(p)
}

// GET /api/files/read?path= — JSON from `ripmail read <path> --json`
files.get('/read', async c => {
  const raw = c.req.query('path')
  if (!raw?.trim()) {
    return c.json({ error: 'missing path' }, 400)
  }
  const fullPath = expandToAbsolute(raw)
  if (
    isMultiTenantMode() &&
    !isAbsolutePathAllowedUnderRoots(fullPath, brainHome(), [ripmailHomeForBrain()])
  ) {
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
    const { stdout, stderr } = await execRipmailAsync(`${rm} read ${JSON.stringify(fullPath)} --json`, {
      ...ripmailReadExecOptions(),
    })
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
