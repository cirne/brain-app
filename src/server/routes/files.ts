/**
 * Read raw files on disk via ripmail (same extraction as CLI `ripmail read <path> --json --full-body`).
 * Not for wiki markdown — use `/api/wiki` for Brain wiki pages.
 */
import { existsSync, statSync } from 'node:fs'
import { Hono } from 'hono'
import { execRipmailAsync } from '@server/lib/ripmail/ripmailRun.js'
import { ripmailReadExecOptions } from '@server/lib/ripmail/ripmailReadExec.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { assertAgentReadPathAllowed, ripmailReadIdLooksLikeFilesystemPath } from '@server/agent/agentToolPolicy.js'
import {
  buildReadPathAllowlist,
  expandRawPathToAbsolute,
  isAgentReadPathAllowed,
} from '@server/lib/chat/agentPathPolicy.js'

const files = new Hono()

/** Normalize `ripmail read --json` for Drive vs localDir (viewer JSON; not frontmatter). */
function normalizeIndexedRipmailJson(j: Record<string, unknown>, queryId: string) {
  const sk = j.sourceKind
  if (sk === 'googleDrive') {
    return {
      id: queryId,
      sourceKind: 'googleDrive' as const,
      title: typeof j.title === 'string' ? j.title : queryId,
      body: typeof j.body === 'string' ? j.body : '',
      mime: typeof j.mime === 'string' ? j.mime : 'application/octet-stream',
      readStatus: typeof j.readStatus === 'string' ? j.readStatus : 'ok',
    }
  }
  if (sk === 'localDir') {
    const path = typeof j.path === 'string' ? j.path : queryId
    const title =
      typeof j.filename === 'string' ? j.filename : path.split(/[/\\]/).filter(Boolean).pop() ?? path
    return {
      id: path,
      sourceKind: 'localDir' as const,
      title,
      body: typeof j.bodyText === 'string' ? j.bodyText : '',
      mime: typeof j.mime === 'string' ? j.mime : 'application/octet-stream',
      readStatus: typeof j.readStatus === 'string' ? j.readStatus : 'ok',
    }
  }
  return null
}

// GET /api/files/indexed?id=&source= — structured JSON for IndexedFileViewer (ripmail read --json --full-body)
files.get('/indexed', async c => {
  const rawId = c.req.query('id')
  const source = c.req.query('source')?.trim()
  if (!rawId?.trim()) {
    return c.json({ error: 'missing id' }, 400)
  }
  let readArg = rawId.trim()
  try {
    if (ripmailReadIdLooksLikeFilesystemPath(readArg)) {
      readArg = await assertAgentReadPathAllowed(readArg)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return c.json({ error: msg }, 403)
  }
  const src = source?.length ? ` --source ${JSON.stringify(source)}` : ''
  const rm = ripmailBin()
  try {
    const { stdout, stderr } = await execRipmailAsync(
      `${rm} read ${JSON.stringify(readArg)} --json --full-body${src}`,
      {
        ...ripmailReadExecOptions(),
      },
    )
    if (stderr?.trim()) {
      console.warn('[api/files/indexed] ripmail stderr:', stderr.slice(0, 500))
    }
    const trimmed = stdout.trim()
    if (!trimmed) {
      return c.json({ error: 'empty output from ripmail' }, 502)
    }
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return c.json({ error: 'invalid JSON from ripmail', raw: trimmed.slice(0, 200) }, 502)
    }
    const normalized = normalizeIndexedRipmailJson(parsed, rawId.trim())
    if (!normalized) {
      return c.json({ error: 'not an indexed file read (expected googleDrive or localDir)' }, 422)
    }
    return c.json(normalized)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/files/indexed]', msg)
    return c.json({ error: msg }, 500)
  }
})

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
