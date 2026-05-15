/**
 * Read raw files on disk via ripmail (same extraction as CLI `ripmail read <path> --json --full-body`).
 * Not for wiki markdown — use `/api/wiki` for Brain wiki pages.
 */
import { existsSync } from 'node:fs'
import { Hono } from 'hono'
import { decodeVisualArtifactRef } from '@shared/visualArtifacts.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { prepareRipmailDb, ripmailReadIndexedFile, readIndexedFileResultToViewerPayload } from '@server/ripmail/index.js'
import { resolveVisualArtifactResponse } from '@server/ripmail/visualArtifacts.js'
import { assertAgentReadPathAllowed, ripmailReadIdLooksLikeFilesystemPath } from '@server/agent/agentToolPolicy.js'
import {
  buildReadPathAllowlist,
  expandRawPathToAbsolute,
  isAgentReadPathAllowed,
} from '@server/lib/chat/agentPathPolicy.js'

const files = new Hono()

// GET /api/files/artifact?ref= — visual artifact bytes resolved through tenant ripmail DB.
files.get('/artifact', async c => {
  const ref = c.req.query('ref')
  if (!ref?.trim()) {
    return c.json({ error: 'missing ref' }, 400)
  }
  const payload = decodeVisualArtifactRef(ref)
  if (!payload) {
    return c.json({ error: 'invalid artifact ref' }, 400)
  }
  try {
    const home = ripmailHomeForBrain()
    const db = await prepareRipmailDb(home)
    return await resolveVisualArtifactResponse(c, db, home, payload)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/files/artifact]', msg)
    return c.json({ error: msg }, 500)
  }
})

// GET /api/files/indexed?id=&source= — structured JSON for IndexedFileViewer (ripmail read --json --full-body)
files.get('/indexed', async c => {
  const rawId = c.req.query('id')
  const sourceId = c.req.query('source')?.trim()
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
  try {
    const result = await ripmailReadIndexedFile(ripmailHomeForBrain(), readArg, {
      fullBody: true,
      sourceId: sourceId || undefined,
    })
    if (!result) {
      return c.json({ error: 'not an indexed file read (expected googleDrive or localDir)' }, 422)
    }
    const normalized = readIndexedFileResultToViewerPayload(result, rawId.trim())
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
  try {
    const result = await ripmailReadIndexedFile(ripmailHomeForBrain(), fullPath, { fullBody: true })
    if (!result) {
      return c.json({ error: 'file not found in index' }, 404)
    }
    return c.json({ id: result.id, sourceKind: result.sourceKind, title: result.title, bodyText: result.bodyText })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[api/files/read]', msg)
    return c.json({ error: msg }, 500)
  }
})

export default files
