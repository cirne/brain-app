import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeVisualArtifactRef } from '@shared/visualArtifacts.js'
import filesRoute from './files.js'
import { openRipmailDb, closeRipmailDb, ripmailDbPath } from '@server/ripmail/index.js'
import type { RipmailDb } from '@server/ripmail/db.js'
import { brainLayoutRipmailDir } from '@server/lib/platform/brainLayout.js'

describe('GET /api/files/artifact', () => {
  let brainHome: string
  let ripmailHome: string
  let db: RipmailDb
  let app: Hono

  beforeEach(async () => {
    brainHome = await mkdtemp(join(tmpdir(), 'files-artifact-'))
    process.env.BRAIN_HOME = brainHome
    ripmailHome = brainLayoutRipmailDir(brainHome)
    await mkdir(ripmailHome, { recursive: true })
    db = openRipmailDb(ripmailHome)
    app = new Hono()
    app.route('/api/files', filesRoute)
  })

  afterEach(async () => {
    closeRipmailDb(ripmailHome)
    await rm(brainHome, { recursive: true, force: true })
    delete process.env.BRAIN_HOME
  })

  function seedMessage(mid = '<mid@test>') {
    db.prepare(`
      INSERT INTO messages (message_id, thread_id, folder, uid, from_address, to_addresses,
                            cc_addresses, to_recipients, cc_recipients, subject, date,
                            body_text, raw_path, source_id)
      VALUES (?, ?, 'INBOX', 1, 'a@test', '[]', '[]', '[]', '[]', 'Subj', '2026-01-01', 'body', 'x.eml', 'src')
    `).run(mid, mid)
  }

  it('serves a visual mail attachment through an opaque artifact ref', async () => {
    seedMessage()
    const imagePath = join(ripmailHome, 'src', 'attachments', 'image.png')
    await mkdir(join(ripmailHome, 'src', 'attachments'), { recursive: true })
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    db.prepare(
      `INSERT INTO attachments (message_id, filename, mime_type, size, stored_path) VALUES (?, ?, ?, ?, ?)`,
    ).run('<mid@test>', 'image.png', 'image/png', 4, imagePath)

    const ref = encodeVisualArtifactRef({ v: 1, type: 'mailAttachment', messageId: 'mid@test', attachmentIndex: 1 })
    const res = await app.request(`/api/files/artifact?ref=${encodeURIComponent(ref)}`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  it('rejects indexed file artifacts outside the tenant read allowlist', async () => {
    db.prepare(`INSERT INTO sources (id, kind, label) VALUES ('src', 'localDir', 'src')`).run()
    db.prepare(
      `INSERT INTO files (source_id, rel_path, abs_path, mtime, size, mime, title, body_text)
       VALUES ('src', 'passwd.png', '/etc/passwd', 0, 4, 'image/png', 'passwd.png', '')`,
    ).run()

    const ref = encodeVisualArtifactRef({ v: 1, type: 'indexedFile', id: '/etc/passwd' })
    const res = await app.request(`/api/files/artifact?ref=${encodeURIComponent(ref)}`)

    expect(res.status).toBe(403)
  })

  it('keeps the test DB under the tenant ripmail directory', () => {
    expect(ripmailDbPath(ripmailHome)).toContain(brainHome)
  })
})
