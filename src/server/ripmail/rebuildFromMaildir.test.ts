/**
 * Tests for maildir → SQLite rebuild (Rust rebuild-index parity).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { closeRipmailDb, openRipmailDb } from './db.js'

const { parseEmlMock, delegateToActualParseEml } = vi.hoisted(() => {
  async function delegateToActualParseEml(
    raw: Buffer | string,
    rawPath: string,
    opts: { folder: string; uid: number; sourceId: string; labels?: string[]; category?: string },
  ) {
    const mod = await vi.importActual<typeof import('./sync/parse.js')>('./sync/parse.js')
    return mod.parseEml(raw, rawPath, opts)
  }
  return { parseEmlMock: vi.fn(delegateToActualParseEml), delegateToActualParseEml }
})

vi.mock('./sync/parse.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sync/parse.js')>()
  return { ...actual, parseEml: parseEmlMock as typeof actual.parseEml }
})

import {
  collectEmlPaths,
  inferMailboxIdFromMaildirRoot,
  rebuildIndexFromMaildir,
  repopulateRipmailIndexFromAllMaildirs,
} from './rebuildFromMaildir.js'
import {
  applyRebuildIndexDateNormalization,
  isUntrustworthyIndexDateStr,
} from './sync/ingestDate.js'
import { SCHEMA_VERSION } from './schema.js'

const SAMPLE_EML = `Return-Path: <alice@test.dev>
Received: from test
Message-ID: <seed-msg-1@test.dev>
Date: Mon, 15 Jan 2026 12:00:00 +0000
From: Alice <alice@test.dev>
To: Bob <bob@test.dev>
Subject: Hello rebuild

Body text here.
`

const SAMPLE_EML2 = `Message-ID: <seed-msg-2@test.dev>
Date: Mon, 15 Jan 2026 13:00:00 +0000
From: Carol <carol@test.dev>
To: Dave <dave@test.dev>
Subject: Second mailbox

Second body.
`

describe('ingestDate (rebuild)', () => {
  it('marks pre-1990 RFC3339 as untrustworthy', () => {
    expect(isUntrustworthyIndexDateStr('1980-01-01T00:00:00+00:00')).toBe(true)
    expect(isUntrustworthyIndexDateStr('1997-03-14T12:00:00+00:00')).toBe(false)
  })

  it('applyRebuildIndexDateNormalization clamps to batch floor', () => {
    const p = { date: '1980-01-01T00:00:00+00:00' }
    const floor = '1998-02-01T00:00:00.000Z'
    expect(applyRebuildIndexDateNormalization(p, floor, 'x.eml')).toBe(true)
    expect(p.date).toBe(floor)
  })

  it('drops when no batch floor', () => {
    const p = { date: '1980-01-01T00:00:00+00:00' }
    expect(applyRebuildIndexDateNormalization(p, undefined, 'x.eml')).toBe(false)
  })
})

describe('rebuildIndexFromMaildir', () => {
  let cleanup: string | undefined

  afterEach(() => {
    if (cleanup) {
      try {
        rmSync(cleanup, { recursive: true, force: true })
      } catch {
        /* */
      }
      cleanup = undefined
    }
  })

  it('collects sorted eml paths recursively', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brain-rebuild-walk-'))
    cleanup = dir
    mkdirSync(join(dir, 'nested'), { recursive: true })
    writeFileSync(join(dir, 'nested', 'z.eml'), SAMPLE_EML)
    writeFileSync(join(dir, 'a.eml'), SAMPLE_EML)
    const paths = collectEmlPaths(dir)
    expect(paths.map((p) => p.split(/[/\\]/).pop())).toEqual(['a.eml', 'z.eml'])
  })

  it('inferMailboxIdFromMaildirRoot reads parent of maildir', () => {
    expect(inferMailboxIdFromMaildirRoot('/tmp/x/mbox/maildir')).toBe('mbox')
  })

  it('repopulates from every mailbox maildir under ripmail home', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-repopulate-'))
    cleanup = root
    const ripHome = join(root, 'rip')
    const cur1 = join(ripHome, 'mbox_one', 'maildir', 'cur')
    const cur2 = join(ripHome, 'mbox_two', 'maildir', 'cur')
    mkdirSync(cur1, { recursive: true })
    mkdirSync(cur2, { recursive: true })
    writeFileSync(join(cur1, 'a.eml'), SAMPLE_EML)
    writeFileSync(join(cur2, 'b.eml'), SAMPLE_EML2)

    const n = await repopulateRipmailIndexFromAllMaildirs(ripHome)
    expect(n).toBe(2)

    const db = openRipmailDb(ripHome)
    const c = db.prepare(`SELECT COUNT(*) AS c FROM messages`).get() as { c: number }
    expect(c.c).toBe(2)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    closeRipmailDb(ripHome)
  })

  it('logs bounded rebuild progress for each mailbox root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-repopulate-progress-'))
    cleanup = root
    const ripHome = join(root, 'rip')
    const cur1 = join(ripHome, 'mbox_one', 'maildir', 'cur')
    const cur2 = join(ripHome, 'mbox_two', 'maildir', 'cur')
    mkdirSync(cur1, { recursive: true })
    mkdirSync(cur2, { recursive: true })
    writeFileSync(join(cur1, 'a.eml'), SAMPLE_EML)
    writeFileSync(join(cur2, 'b.eml'), SAMPLE_EML2)

    const infoSpy = vi.spyOn(brainLogger, 'info').mockImplementation(() => undefined)
    try {
      await repopulateRipmailIndexFromAllMaildirs(ripHome)

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ripmail_rebuild',
          phase: 'start',
          ripmailHome: ripHome,
          mailboxCount: 2,
        }),
        expect.stringContaining('ripmail:rebuild:phase'),
      )
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ripmail_rebuild',
          phase: 'maildir',
          ripmailHome: ripHome,
          rootIndex: 1,
          rootCount: 2,
          mailboxId: 'mbox_one',
          emlDiscovered: 1,
        }),
        expect.stringContaining('mailboxId=mbox_one root=1/2'),
      )
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ripmail_rebuild',
          phase: 'maildir_complete',
          ripmailHome: ripHome,
          rootIndex: 1,
          rootCount: 2,
          mailboxId: 'mbox_one',
          percentDone: 100,
          inserted: 1,
          parsed: 1,
        }),
        expect.stringContaining('mailboxId=mbox_one root=1/2 done=100.0% parsed=1 inserted=1'),
      )
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ripmail_rebuild',
          phase: 'complete',
          ripmailHome: ripHome,
          totalInserted: 2,
        }),
        expect.stringContaining('ripmail:rebuild:phase'),
      )
    } finally {
      infoSpy.mockRestore()
      closeRipmailDb(ripHome)
    }
  })

  it('inserts message row and applies bulk-archive bootstrap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-rebuild-db-'))
    cleanup = root
    const ripHome = join(root, 'rip')
    const mbId = 'eval_mail_com'
    const maildir = join(ripHome, mbId, 'maildir', 'cur')
    mkdirSync(maildir, { recursive: true })
    writeFileSync(join(maildir, '0000001.eml'), SAMPLE_EML)

    const n = await rebuildIndexFromMaildir(ripHome, join(ripHome, mbId, 'maildir'))
    expect(n).toBe(1)

    const db = openRipmailDb(ripHome)
    const row = db.prepare(`SELECT message_id, raw_path, is_archived FROM messages`).get() as Record<
      string,
      unknown
    >
    expect(String(row.message_id)).toContain('seed-msg-1')
    expect(String(row.raw_path)).toMatch(/maildir/)
    expect(row.is_archived).toBe(1)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)

    closeRipmailDb(ripHome)
  })

  /**
   * Staging: rebuild child failed with TypeError when mailparser (or similar) yielded a non-string
   * contentType — `att.mimeType?.trim()` still calls `.trim` on non-strings. See NR `ripmail:rebuild:child-failed`.
   */
  it('rebuild insert tolerates non-string attachment mimeType (mailparser edge)', async () => {
    parseEmlMock.mockImplementation(async (raw, rawPath, opts) => {
      const base = await delegateToActualParseEml(raw, rawPath, opts)
      return {
        ...base,
        attachments: [
          {
            filename: 'doc.bin',
            // e.g. numeric or structured Content-Type leaking through — must not throw in insert trx
            mimeType: 42 as unknown as string,
            size: 100,
            storedPath: '',
          },
        ],
      }
    })

    const root = mkdtempSync(join(tmpdir(), 'brain-rebuild-mime-'))
    cleanup = root
    const ripHome = join(root, 'rip')
    const mbId = 'eval_mail_com'
    const maildir = join(ripHome, mbId, 'maildir', 'cur')
    mkdirSync(maildir, { recursive: true })
    writeFileSync(join(maildir, '0000001.eml'), SAMPLE_EML)

    try {
      const n = await rebuildIndexFromMaildir(ripHome, join(ripHome, mbId, 'maildir'))
      expect(n).toBe(1)

      const db = openRipmailDb(ripHome)
      const att = db.prepare(`SELECT mime_type FROM attachments`).get() as { mime_type: string }
      expect(att.mime_type).toBe('application/octet-stream')
      closeRipmailDb(ripHome)
    } finally {
      parseEmlMock.mockImplementation(delegateToActualParseEml)
    }
  })
})
