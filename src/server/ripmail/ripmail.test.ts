/**
 * Unit tests for the TypeScript ripmail module.
 *
 * Tests run against in-memory SQLite databases (no disk I/O, no corpus seed required).
 * Validates: schema, search, readMail, inbox, rules, archive, calendar, sources.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import { openMemoryRipmailDb, openRipmailDb, closeRipmailDb } from './db.js'
import { SCHEMA_VERSION } from './schema.js'
import { search } from './search.js'
import { readMail, readMailForDisplay } from './mailRead.js'
import { who } from './who.js'
import { status } from './status.js'
import { inbox, loadRulesFile, getBundledRulesetRevision } from './inbox.js'
import { archive } from './archive.js'
import { rulesList, rulesAdd, rulesEdit, rulesRemove, rulesValidate } from './rules.js'
import { sourcesList, sourcesAddLocalDir, sourcesRemove, ensureSourceRowsFromConfig } from './sources.js'
import { calendarRange, calendarCreateEvent, calendarDeleteEvent, calendarListCalendars } from './calendar.js'
import { draftNew, draftEdit, draftView } from './draft.js'
import type { RipmailDb } from './db.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a message row directly for testing. */
function insertMessage(
  db: RipmailDb,
  overrides: Partial<{
    messageId: string
    subject: string
    fromAddress: string
    fromName: string
    toAddresses: string
    date: string
    bodyText: string
    bodyHtml: string
    rawPath: string
    sourceId: string
    category: string
    isArchived: number
  }> = {},
): string {
  const mid = overrides.messageId ?? `<test-${randomUUID()}>`
  db.prepare(`
    INSERT INTO messages (message_id, thread_id, folder, uid, from_address, from_name,
                          to_addresses, cc_addresses, to_recipients, cc_recipients,
                          subject, date, body_text, body_html, raw_path, source_id, is_archived)
    VALUES (?, ?, 'INBOX', 1, ?, ?, ?, '[]', '[]', '[]', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mid,
    mid,
    overrides.fromAddress ?? 'alice@example.com',
    overrides.fromName ?? 'Alice',
    overrides.toAddresses ?? '["bob@example.com"]',
    overrides.subject ?? 'Test Subject',
    overrides.date ?? '2026-01-15T10:00:00Z',
    overrides.bodyText ?? 'Test body content',
    overrides.bodyHtml ?? null,
    overrides.rawPath ?? '',
    overrides.sourceId ?? 'test-source',
    overrides.isArchived ?? 0,
  )
  if (overrides.category) {
    db.prepare(`UPDATE messages SET category = ? WHERE message_id = ?`).run(overrides.category, mid)
  }
  return mid
}

function ensureRipmailSource(db: RipmailDb, id: string, kind: string) {
  db.prepare(`INSERT OR IGNORE INTO sources (id, kind, include_in_default) VALUES (?, ?, 1)`).run(id, kind)
}

function insertIndexedLocalFile(
  db: RipmailDb,
  opts: {
    sourceId: string
    relPath?: string
    title?: string
    bodyText?: string
    dateIso?: string
  },
) {
  const relPath = opts.relPath ?? 'notes/x.md'
  const absPath = `/vault/${opts.sourceId}/${relPath.replace(/\\/g, '/')}`
  ensureRipmailSource(db, opts.sourceId, 'localDir')
  db.prepare(`
    INSERT INTO files (source_id, rel_path, abs_path, mtime, size, mime, title, body_text)
    VALUES (?, ?, ?, 0, 0, ?, ?, ?)
  `).run(opts.sourceId, relPath.replace(/\\/g, '/'), absPath, null, opts.title ?? '', opts.bodyText ?? '')
  db.prepare(`
    INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso)
    VALUES (?, 'file', ?, ?, ?, ?)
  `).run(
    opts.sourceId,
    relPath.replace(/\\/g, '/'),
    opts.title ?? '',
    opts.bodyText ?? '',
    opts.dateIso ?? '2026-01-01',
  )
}

function insertIndexedDriveDoc(
  db: RipmailDb,
  opts: {
    sourceId: string
    extId?: string
    title?: string
    body?: string
    dateIso?: string
  },
) {
  const extId = opts.extId ?? 'gdrive-ext-1'
  ensureRipmailSource(db, opts.sourceId, 'googleDrive')
  db.prepare(`
    INSERT INTO document_index (source_id, kind, ext_id, title, body, date_iso)
    VALUES (?, 'googleDrive', ?, ?, ?, ?)
  `).run(opts.sourceId, extId, opts.title ?? '', opts.body ?? '', opts.dateIso ?? '2026-01-01')
}

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('schema', () => {
  it('SCHEMA_VERSION is 31', () => {
    expect(SCHEMA_VERSION).toBe(31)
  })

  it('openMemoryRipmailDb creates DB with expected tables', () => {
    const db = openMemoryRipmailDb()
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    expect(names).toContain('messages')
    expect(names).toContain('sources')
    expect(names).toContain('attachments')
    expect(names).toContain('calendar_events')
    expect(names).toContain('inbox_decisions')
    expect(names).toContain('document_index')
    db.close()
  })

  it('document_index_fts trigger fires on message insert', () => {
    const db = openMemoryRipmailDb()
    insertMessage(db, { subject: 'FTS trigger test' })
    const row = db
      .prepare(`SELECT title FROM document_index WHERE kind='mail' AND title LIKE '%FTS trigger test%' LIMIT 1`)
      .get() as { title: string } | undefined
    expect(row?.title).toContain('FTS trigger test')
    db.close()
  })
})

// ---------------------------------------------------------------------------
// Search tests
// ---------------------------------------------------------------------------

describe('search', () => {
  let db: RipmailDb
  beforeEach(() => {
    db = openMemoryRipmailDb()
    insertMessage(db, { subject: 'Budget Q1 Report', bodyText: 'Financial overview for Q1 2026', fromAddress: 'finance@corp.com', date: '2026-03-01T09:00:00Z' })
    insertMessage(db, { subject: 'Team meeting', bodyText: 'Let us meet next week', fromAddress: 'team@corp.com', date: '2026-03-10T14:00:00Z' })
    insertMessage(db, { subject: 'Invoice #123', bodyText: 'Payment due for services', fromAddress: 'billing@corp.com', date: '2025-12-01T10:00:00Z' })
  })

  it('returns results for regex pattern', () => {
    const r = search(db, { query: 'Budget', includeAll: true })
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.results[0]!.subject).toContain('Budget')
  })

  it('filters by from address', () => {
    const r = search(db, { from: 'finance@corp.com', includeAll: true })
    expect(r.results.every((m) => m.fromAddress.includes('finance'))).toBe(true)
  })

  it('filters by date range', () => {
    const r = search(db, { afterDate: '2026-01-01', includeAll: true })
    expect(r.results.every((m) => m.date >= '2026')).toBe(true)
  })

  it('returns empty results with hint for invalid regex', () => {
    const r = search(db, { query: '[invalid-regex', includeAll: true })
    expect(r.results).toHaveLength(0)
    expect(r.hints.some((h) => h.toLowerCase().includes('invalid'))).toBe(true)
  })

  it('filter-only search (no pattern) works', () => {
    const r = search(db, { from: 'billing@corp.com', includeAll: true })
    expect(r.results.length).toBeGreaterThan(0)
    expect(r.results[0]!.fromAddress).toContain('billing')
  })

  it('rolling afterDate resolves from rollingAnchorDate (UTC-stable)', () => {
    const prevTz = process.env.TZ
    process.env.TZ = 'UTC'
    try {
      insertMessage(db, {
        subject: 'Inside rolling window',
        bodyText: 'x',
        fromAddress: 'in@corp.com',
        date: '2001-12-20T09:00:00Z',
      })
      insertMessage(db, {
        subject: 'Outside rolling window',
        bodyText: 'x',
        fromAddress: 'out@corp.com',
        date: '2001-06-01T09:00:00Z',
      })
      const anchor = new Date(Date.UTC(2002, 0, 1, 12, 0, 0))
      const r = search(db, {
        query: 'rolling',
        afterDate: '30d',
        rollingAnchorDate: anchor,
        includeAll: true,
      })
      expect(r.results.some((m) => m.subject === 'Inside rolling window')).toBe(true)
      expect(r.results.some((m) => m.subject === 'Outside rolling window')).toBe(false)
    } finally {
      if (prevTz === undefined) delete process.env.TZ
      else process.env.TZ = prevTz
    }
  })

  it('normalizes messageId — no angle brackets in results', () => {
    const r = search(db, { query: 'Budget', includeAll: true })
    for (const res of r.results) {
      expect(res.messageId).not.toMatch(/^</)
      expect(res.messageId).not.toMatch(/>$/)
    }
  })

  it('respects limit', () => {
    const r = search(db, { includeAll: true, limit: 1 })
    expect(r.results.length).toBeLessThanOrEqual(1)
  })

  it('treats pattern as an alias for query', () => {
    const rq = search(db, { query: 'Invoice', includeAll: true })
    const rp = search(db, { pattern: 'Invoice', includeAll: true })
    expect(rp.results.length).toBe(rq.results.length)
    expect(new Set(rq.results.map((x) => x.messageId))).toEqual(new Set(rp.results.map((x) => x.messageId)))
  })

  it('rejects inline from:/to:/subject:/category: in the regex string', () => {
    const r = search(db, { query: 'from:alice@corp.com Budget', includeAll: true })
    expect(r.results).toHaveLength(0)
    expect(r.hints.join('\n')).toMatch(/inline operators/i)
    expect(r.hints.join('\n')).toMatch(/from:/i)
  })

  it('respects caseSensitive for mail regex matching', () => {
    insertMessage(db, {
      subject: 'Case ping',
      bodyText: 'TokenUPPERCASE unique',
      fromAddress: 'case@corp.com',
      date: '2026-04-01T12:00:00Z',
    })
    insertMessage(db, {
      subject: 'Case pong',
      bodyText: 'Tokenuppercase unique',
      fromAddress: 'case2@corp.com',
      date: '2026-04-02T12:00:00Z',
    })
    const ins = search(db, { query: 'Tokenuppercase', caseSensitive: false, includeAll: true })
    expect(ins.results.filter((x) => x.sourceKind === 'mail' && x.bodyPreview.includes('Token'))).toHaveLength(2)

    const sens = search(db, { query: 'Tokenuppercase', caseSensitive: true, includeAll: true })
    expect(sens.results.filter((x) => x.sourceKind === 'mail' && x.bodyPreview.includes('Tokenuppercase'))).toHaveLength(1)
  })

  it('applies offset and reports totalMatched for pattern search', () => {
    insertMessage(db, {
      subject: 'Z1',
      bodyText: 'ZEBRA_TERM one',
      fromAddress: 'z@corp.com',
      date: '2026-01-20T12:00:00Z',
    })
    insertMessage(db, {
      subject: 'Z2',
      bodyText: 'ZEBRA_TERM two',
      fromAddress: 'z@corp.com',
      date: '2026-01-21T12:00:00Z',
    })
    insertMessage(db, {
      subject: 'Z3',
      bodyText: 'ZEBRA_TERM three',
      fromAddress: 'z@corp.com',
      date: '2026-01-22T12:00:00Z',
    })
    const anchor = new Date(Date.UTC(2026, 5, 1, 0, 0, 0))
    const full = search(db, { query: 'ZEBRA_TERM', includeAll: true, rollingAnchorDate: anchor })
    expect(full.totalMatched).toBe(3)

    const page = search(db, {
      query: 'ZEBRA_TERM',
      includeAll: true,
      rollingAnchorDate: anchor,
      limit: 1,
      offset: 2,
    })
    expect(page.results).toHaveLength(1)
    expect(page.results[0]!.subject).toBe('Z1')
    expect(page.totalMatched).toBe(3)
  })

  it('matches Google Drive rows in document_index (regex across title, ext id, body)', () => {
    insertIndexedDriveDoc(db, {
      sourceId: 'drive-unit',
      extId: 'file-unique-99',
      title: 'Quarterly roadmap',
      body: 'Discuss widgets and rollout',
      dateIso: '2026-02-01',
    })
    const r = search(db, { query: 'widgets', includeAll: true })
    const hit = r.results.find((x) => x.sourceKind === 'googleDrive')
    expect(hit?.messageId).toBe('file-unique-99')
    expect(hit?.subject).toContain('Quarterly')
  })

  it('matches indexed localDir files joined to document_index(kind=file)', () => {
    insertIndexedLocalFile(db, {
      sourceId: 'vault-local',
      relPath: 'team/notes.md',
      title: '',
      bodyText: 'PIN_LOCAL_DIR_TOKEN for search',
      dateIso: '2026-03-05',
    })
    const r = search(db, { query: 'PIN_LOCAL_DIR_TOKEN', includeAll: true })
    const hit = r.results.find((x) => x.sourceKind === 'localDir')
    expect(hit?.indexedRelPath).toBe('team/notes.md')
    expect(hit?.messageId).toContain('/vault/vault-local/team/notes.md')
  })

  it('omits indexed file/Drive hits when structured from is set (mail filters still apply)', () => {
    const d = openMemoryRipmailDb()
    insertIndexedDriveDoc(d, {
      sourceId: 'g-only',
      extId: 'only-drive',
      title: 'ALPHA_DRIVE_ONLY_TERM',
      body: '',
      dateIso: '2026-01-01',
    })
    insertMessage(d, {
      subject: 'No keyword here',
      bodyText: 'unrelated mail body',
      fromAddress: 'someone@corp.com',
      date: '2026-06-01T12:00:00Z',
    })
    expect(search(d, { query: 'ALPHA_DRIVE_ONLY_TERM', includeAll: true }).results.some((x) => x.sourceKind === 'googleDrive')).toBe(
      true,
    )
    expect(
      search(d, {
        query: 'ALPHA_DRIVE_ONLY_TERM',
        from: 'someone@corp.com',
        includeAll: true,
      }).results,
    ).toHaveLength(0)
  })

  it('omits indexed file/Drive hits when structured to is set', () => {
    const d = openMemoryRipmailDb()
    insertIndexedLocalFile(d, {
      sourceId: 'lv',
      bodyText: 'BETA_LOCAL_ONLY_TERM',
    })
    insertMessage(d, {
      subject: 'x',
      bodyText: 'x',
      fromAddress: 'sender@corp.com',
      toAddresses: '["target@corp.com"]',
      date: '2026-06-01T12:00:00Z',
    })
    expect(search(d, { query: 'BETA_LOCAL_ONLY_TERM', includeAll: true }).results.some((x) => x.sourceKind === 'localDir')).toBe(
      true,
    )
    expect(
      search(d, { query: 'BETA_LOCAL_ONLY_TERM', to: 'target@corp.com', includeAll: true }).results,
    ).toHaveLength(0)
  })

  it('omits indexed file/Drive hits when structured subject filter is set', () => {
    const d = openMemoryRipmailDb()
    insertIndexedDriveDoc(d, {
      sourceId: 'gx',
      extId: 'e1',
      title: 'GAMMA_DOC_ONLY_TERM',
      body: '',
    })
    insertMessage(d, { subject: 'Filter subject latch', bodyText: 'zzz', date: '2026-06-02T12:00:00Z' })
    expect(search(d, { query: 'GAMMA_DOC_ONLY_TERM', includeAll: true }).results.some((x) => x.sourceKind === 'googleDrive')).toBe(
      true,
    )
    expect(search(d, { query: 'GAMMA_DOC_ONLY_TERM', subject: 'latch', includeAll: true }).results).toHaveLength(0)
  })

  it('omits indexed file/Drive hits when structured category filter is set', () => {
    const d = openMemoryRipmailDb()
    insertIndexedDriveDoc(d, {
      sourceId: 'gy',
      extId: 'e2',
      title: 'DELTA_DOC_TERM',
      body: '',
    })
    insertMessage(d, {
      subject: 'categorized',
      bodyText: 'zzz',
      fromAddress: 'c@corp.com',
      category: 'work',
      date: '2026-06-03T12:00:00Z',
    })
    expect(search(d, { query: 'DELTA_DOC_TERM', includeAll: true }).results.some((x) => x.sourceKind === 'googleDrive')).toBe(
      true,
    )
    expect(search(d, { query: 'DELTA_DOC_TERM', category: 'work', includeAll: true }).results).toHaveLength(0)
  })

  it('restricts Google Drive candidates with sourceIds', () => {
    insertIndexedDriveDoc(db, { sourceId: 'drive-A', extId: 'fa', title: 'SharedTitle', body: 'OMEGA_BOTH' })
    insertIndexedDriveDoc(db, { sourceId: 'drive-B', extId: 'fb', title: 'SharedTitle', body: 'OMEGA_BOTH' })
    const both = search(db, { query: 'OMEGA_BOTH', includeAll: true })
    expect(both.results.filter((x) => x.sourceKind === 'googleDrive')).toHaveLength(2)

    const aOnly = search(db, { query: 'OMEGA_BOTH', sourceIds: ['drive-A'], includeAll: true })
    const driveHits = aOnly.results.filter((x) => x.sourceKind === 'googleDrive')
    expect(driveHits).toHaveLength(1)
    expect(driveHits[0]!.sourceId).toBe('drive-A')
    expect(aOnly.results.every((x) => x.sourceKind !== 'googleDrive' || x.sourceId === 'drive-A')).toBe(true)
  })

  it('combines mail, local file, and Drive hits in one regex search when file filters are unrestricted', () => {
    insertIndexedDriveDoc(db, {
      sourceId: 'combo-g',
      extId: 'cid-1',
      title: 'UNIFY_TRIAD',
      body: '',
      dateIso: '2026-01-10',
    })
    insertIndexedLocalFile(db, {
      sourceId: 'combo-l',
      bodyText: 'Also mentions UNIFY_TRIAD in file',
      dateIso: '2026-01-11',
    })
    insertMessage(db, {
      subject: 'UNIFY_TRIAD in mail',
      bodyText: '.',
      fromAddress: 'm@corp.com',
      date: '2026-01-12T12:00:00Z',
    })
    const r = search(db, { query: 'UNIFY_TRIAD', includeAll: true })
    const kinds = new Set(r.results.map((x) => x.sourceKind))
    expect(kinds.has('mail')).toBe(true)
    expect(kinds.has('localDir')).toBe(true)
    expect(kinds.has('googleDrive')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// readMail tests
// ---------------------------------------------------------------------------

describe('readMail', () => {
  let db: RipmailDb
  beforeEach(() => {
    db = openMemoryRipmailDb()
  })

  it('returns null for unknown message', () => {
    expect(readMail(db, 'unknown-id')).toBeNull()
  })

  it('reads message by bare ID (no angle brackets)', () => {
    const mid = insertMessage(db, { subject: 'Hello', bodyText: 'World' })
    const bareId = mid.startsWith('<') ? mid.slice(1, -1) : mid
    const r = readMail(db, bareId)
    expect(r).not.toBeNull()
    expect(r!.subject).toBe('Hello')
    expect(r!.messageId).not.toMatch(/^</)
  })

  it('reads message by bracketed ID', () => {
    const mid = insertMessage(db, { subject: 'Bracketed', messageId: '<bracket@test>' })
    const r = readMail(db, mid)
    expect(r).not.toBeNull()
    expect(r!.subject).toBe('Bracketed')
  })

  it('returns body text', () => {
    insertMessage(db, { subject: 'Body test', bodyText: 'The quick brown fox', messageId: '<body@test>' })
    const r = readMail(db, 'body@test')
    expect(r!.bodyText).toContain('quick brown fox')
  })

  it('returns stored HTML body only when requested', () => {
    insertMessage(db, {
      subject: 'HTML body test',
      bodyText: 'Plain fallback',
      bodyHtml: '<html><body><p>HTML body</p></body></html>',
      messageId: '<body-html@test>',
    })
    expect(readMail(db, 'body-html@test')!.bodyHtml).toBeUndefined()
    const r = readMail(db, 'body-html@test', { includeHtml: true })
    expect(r!.bodyHtml).toContain('<p>HTML body</p>')
  })

  it('returns isArchived flag', () => {
    insertMessage(db, { messageId: '<arch@test>', isArchived: 1 })
    const r = readMail(db, 'arch@test')
    expect(r!.isArchived).toBe(true)
  })
})

describe('readMailForDisplay', () => {
  let db: RipmailDb

  beforeEach(() => {
    db = openMemoryRipmailDb()
  })

  afterEach(() => {
    db.close()
  })

  it('returns plaintext display content from stored body_text', () => {
    insertMessage(db, {
      messageId: '<display-text@test>',
      subject: 'Text only',
      bodyText: 'Stored text fallback',
      rawPath: 'text-only.eml',
    })

    const r = readMailForDisplay(db, '/unused/ripmail-home', 'display-text@test')
    expect(r).not.toBeNull()
    expect(r!.bodyKind).toBe('text')
    expect(r!.bodyText).toBe('Stored text fallback')
    expect(r!.bodyHtml).toBeUndefined()
  })

  it('returns stored HTML display content without reparsing raw_path', () => {
    insertMessage(db, {
      messageId: '<display-html@test>',
      subject: 'Multipart',
      bodyText: 'Plain fallback body.',
      bodyHtml: '<html><body><p>HTML body</p></body></html>',
      rawPath: 'missing-or-stale.eml',
    })

    const r = readMailForDisplay(db, '/unused/ripmail-home', 'display-html@test')
    expect(r).not.toBeNull()
    expect(r!.bodyKind).toBe('html')
    expect(r!.bodyText).toBe('Plain fallback body.')
    expect(r!.bodyHtml).toContain('<p>HTML body</p>')
  })

  it('does not let a raw_path influence display HTML when body_html is absent', () => {
    insertMessage(db, {
      messageId: '<display-mismatch@test>',
      subject: 'Correct DB row',
      bodyText: 'Correct stored text',
      rawPath: 'wrong-message.eml',
    })

    const r = readMailForDisplay(db, '/unused/ripmail-home', 'display-mismatch@test')
    expect(r).not.toBeNull()
    expect(r!.bodyKind).toBe('text')
    expect(r!.bodyText).toBe('Correct stored text')
    expect(r!.bodyHtml).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// who tests
// ---------------------------------------------------------------------------

describe('who', () => {
  let db: RipmailDb
  beforeEach(() => {
    db = openMemoryRipmailDb()
    for (let i = 0; i < 5; i++) {
      insertMessage(db, { fromAddress: 'alice@example.com', fromName: 'Alice Smith', date: `2026-01-0${i + 1}T10:00:00Z` })
    }
    insertMessage(db, { fromAddress: 'bob@example.com', fromName: 'Bob Jones' })
  })

  it('returns contacts aggregated from messages', () => {
    const r = who(db)
    expect(r.contacts.length).toBeGreaterThan(0)
  })

  it('filters contacts by query', () => {
    const r = who(db, 'alice', { limit: 10 })
    expect(r.contacts.length).toBeGreaterThan(0)
    expect(r.contacts.some((c) => c.primaryAddress.includes('alice'))).toBe(true)
  })

  it('returns empty list for unknown query', () => {
    const r = who(db, 'zzz-unknown-xyz')
    expect(r.contacts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// status tests
// ---------------------------------------------------------------------------

describe('status', () => {
  it('returns indexedMessages count', () => {
    const db = openMemoryRipmailDb()
    insertMessage(db, {})
    insertMessage(db, {})
    const s = status(db)
    expect(s.indexedMessages).toBe(2)
    db.close()
  })

  it('returns sources list', () => {
    const db = openMemoryRipmailDb()
    db.prepare(`INSERT INTO sources (id, kind) VALUES ('s1', 'imap')`).run()
    const s = status(db)
    expect(s.sources.some((src) => src.sourceId === 's1')).toBe(true)
    db.close()
  })
})

// ---------------------------------------------------------------------------
// inbox tests
// ---------------------------------------------------------------------------

describe('inbox', () => {
  let db: RipmailDb
  let tmpHome: string

  beforeEach(() => {
    db = openMemoryRipmailDb()
    tmpHome = join(tmpdir(), `ripmail-test-${randomUUID()}`)
    mkdirSync(tmpHome, { recursive: true })
    insertMessage(db, {
      subject: 'Hello from Bob',
      fromAddress: 'bob@example.com',
      bodyText: 'How are you?',
      date: new Date().toISOString(),
    })
    insertMessage(db, {
      subject: 'Weekly Newsletter',
      fromAddress: 'news@newsletter.com',
      bodyText: 'View in browser to unsubscribe',
      date: new Date().toISOString(),
    })
  })

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore cleanup errors */ }
  })

  it('returns items for recent messages', () => {
    const r = inbox(db, tmpHome, { since: '30d', thorough: true })
    expect(r.items.length).toBeGreaterThan(0)
  })

  it('fallback heuristic marks unsubscribe mail as ignore', () => {
    const r = inbox(db, tmpHome, { since: '30d', thorough: true })
    const newsletter = r.items.find((i) => i.subject.includes('Newsletter'))
    expect(newsletter).toBeDefined()
    expect(newsletter?.action).toBe('ignore')
  })

  it('fallback heuristic marks personal mail as inform', () => {
    const r = inbox(db, tmpHome, { since: '30d' })
    const personal = r.items.find((i) => i.subject.includes('Hello from Bob'))
    if (personal) {
      expect(['notify', 'inform']).toContain(personal.action)
    }
  })

  it('user rule takes precedence over fallback', () => {
    writeFileSync(join(tmpHome, 'rules.json'), JSON.stringify({
      version: 5,
      metadata: { lastAppliedBundledRulesetRevision: getBundledRulesetRevision() },
      rules: [{
        kind: 'search',
        id: 'test-rule',
        action: 'notify',
        query: 'Hello from Bob',
        fromOrToUnion: false,
        threadScope: true,
      }],
      context: [],
    }))
    const r = inbox(db, tmpHome, { since: '30d', thorough: true })
    const personal = r.items.find((i) => i.subject.includes('Hello from Bob'))
    expect(personal?.action).toBe('notify')
    expect(personal?.matchedRuleIds).toContain('test-rule')
  })

  it('thorough scan excludes archived messages', () => {
    const mid = insertMessage(db, {
      subject: 'Visible until archived',
      fromAddress: 'keep@example.com',
      bodyText: 'Note body',
      date: new Date().toISOString(),
    })
    let r = inbox(db, tmpHome, { since: '30d', thorough: true })
    expect(r.items.some((i) => i.messageId === mid)).toBe(true)

    archive(db, [mid])
    r = inbox(db, tmpHome, { since: '30d', thorough: true })
    expect(r.items.some((i) => i.messageId === mid)).toBe(false)
  })

  it('commerce promo subject Sell… falls back to ignore (heuristic) when marketing body cues present', () => {
    insertMessage(db, {
      subject: 'Sell what people are buying',
      fromAddress: 'email@e.therealreal.com',
      bodyText:
        'Consignment marketing.\n\nTwo-factor authentication keeps your account secure.\nManage preferences',
      date: new Date().toISOString(),
    })
    const r = inbox(db, tmpHome, { since: '30d', thorough: true })
    const item = r.items.find((i) => i.subject === 'Sell what people are buying')
    expect(item).toBeDefined()
    expect(item?.action).toBe('ignore')
    expect(item?.decisionSource).toBe('fallback')
  })

  it('verification-code mail falls back to inform without OTP notify rule', () => {
    insertMessage(db, {
      subject: 'Your sign-in verification',
      fromAddress: 'security@example.com',
      bodyText: 'Your verification code is 847291. Do not share this code.',
      date: new Date().toISOString(),
    })
    const r = inbox(db, tmpHome, { since: '30d', thorough: true })
    const item = r.items.find((i) => i.subject.includes('sign-in verification'))
    expect(item?.action).toBe('inform')
    expect(item?.winningRuleId).toBeUndefined()
    expect(item?.decisionSource).toBe('fallback')
  })

  it('replaces on-disk rules when bundled revision is newer than lastApplied', () => {
    writeFileSync(join(tmpHome, 'rules.json'), JSON.stringify({
      version: 4,
      rules: [{
        kind: 'search',
        id: 'stale-custom',
        action: 'notify',
        query: 'something',
        fromOrToUnion: false,
        threadScope: true,
      }],
      context: [],
    }))
    const loaded = loadRulesFile(tmpHome)
    expect(loaded.rules.some((r) => r.id === 'stale-custom')).toBe(false)
    expect(loaded.rules.some((r) => r.id === 'def-cat-spam')).toBe(true)
    const disk = JSON.parse(readFileSync(join(tmpHome, 'rules.json'), 'utf8')) as {
      metadata?: { lastAppliedBundledRulesetRevision?: number }
    }
    expect(disk.metadata?.lastAppliedBundledRulesetRevision).toBe(getBundledRulesetRevision())
  })

  it('preserves custom on-disk rules when lastApplied matches bundled revision', () => {
    const rev = getBundledRulesetRevision()
    writeFileSync(join(tmpHome, 'rules.json'), JSON.stringify({
      version: 5,
      metadata: { lastAppliedBundledRulesetRevision: rev },
      rules: [{
        kind: 'search',
        id: 'keep-me',
        action: 'notify',
        query: 'unique-query-xyz',
        fromOrToUnion: false,
        threadScope: true,
      }],
      context: [],
    }))
    const loaded = loadRulesFile(tmpHome)
    expect(loaded.rules.some((r) => r.id === 'keep-me')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// archive tests
// ---------------------------------------------------------------------------

describe('archive', () => {
  it('sets is_archived = 1 on messages', () => {
    const db = openMemoryRipmailDb()
    const mid = insertMessage(db, {})
    const bareId = mid.slice(1, -1)
    const r = archive(db, [bareId])
    expect(r.results[0]?.local.ok).toBe(false) // Bare ID doesn't match bracketed
    // Try with bracketed ID
    const r2 = archive(db, [mid])
    expect(r2.results[0]?.local.ok).toBe(true)
    const row = db.prepare(`SELECT is_archived FROM messages WHERE message_id = ?`).get(mid) as { is_archived: number }
    expect(row.is_archived).toBe(1)
    db.close()
  })
})

// ---------------------------------------------------------------------------
// rules tests
// ---------------------------------------------------------------------------

describe('rules', () => {
  let tmpHome: string
  beforeEach(() => {
    tmpHome = join(tmpdir(), `ripmail-rules-${randomUUID()}`)
    mkdirSync(tmpHome, { recursive: true })
  })
  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore cleanup errors */ }
  })

  it('lists default rules when no rules.json', () => {
    const r = rulesList(tmpHome)
    expect(r.rules.length).toBeGreaterThan(0)
  })

  it('add/edit/remove round-trip', () => {
    const rule = rulesAdd(tmpHome, { action: 'notify', query: 'test pattern', description: 'My rule' })
    expect(rule.query).toBe('test pattern')

    const edited = rulesEdit(tmpHome, { ruleId: rule.id, action: 'ignore' })
    expect(edited.action).toBe('ignore')

    rulesRemove(tmpHome, { ruleId: rule.id })
    const list = rulesList(tmpHome)
    expect(list.rules.some((r) => r.id === rule.id)).toBe(false)
  })

  it('persists lastAppliedBundledRulesetRevision when saving rules', () => {
    rulesAdd(tmpHome, { action: 'notify', query: 'pat', description: 't' })
    const raw = JSON.parse(readFileSync(join(tmpHome, 'rules.json'), 'utf8')) as {
      metadata?: { lastAppliedBundledRulesetRevision?: number }
    }
    expect(raw.metadata?.lastAppliedBundledRulesetRevision).toBe(getBundledRulesetRevision())
  })

  it('validate detects duplicate ids', () => {
    const id = `rule-${randomUUID().slice(0, 8)}`
    rulesAdd(tmpHome, { ruleId: id, action: 'notify', query: 'foo' })
    // Manually inject duplicate
    const { readFileSync: rfs, writeFileSync: wfs } = _require('node:fs') as typeof import('node:fs')
    const file = JSON.parse(rfs(join(tmpHome, 'rules.json'), 'utf8'))
    file.rules.push({ kind: 'search', id, action: 'ignore', query: 'bar', fromOrToUnion: false, threadScope: true })
    wfs(join(tmpHome, 'rules.json'), JSON.stringify(file))
    const db = openMemoryRipmailDb()
    const v = rulesValidate(db, tmpHome)
    expect(v.errors.some((e) => e.includes('Duplicate'))).toBe(true)
    db.close()
  })
})

// ---------------------------------------------------------------------------
// sources tests
// ---------------------------------------------------------------------------

describe('sources', () => {
  it('add and remove localDir source', () => {
    const db = openMemoryRipmailDb()
    const s = sourcesAddLocalDir(db, { rootIds: ['/tmp/docs'], label: 'My Docs' })
    expect(s.kind).toBe('localDir')
    const list = sourcesList(db)
    expect(list.sources.some((src) => src.id === s.id)).toBe(true)
    sourcesRemove(db, s.id)
    const list2 = sourcesList(db)
    expect(list2.sources.some((src) => src.id === s.id)).toBe(false)
    db.close()
  })

  it('mirrors configured googleCalendar sources into the SQLite sources table', () => {
    const db = openMemoryRipmailDb()
    ensureSourceRowsFromConfig(db, {
      sources: [
        {
          id: 'a_gmail_com-gcal',
          kind: 'googleCalendar',
          email: 'a@gmail.com',
          oauthSourceId: 'a_gmail_com',
        },
      ],
    })
    const list = sourcesList(db)
    const row = list.sources.find((src) => src.id === 'a_gmail_com-gcal')
    expect(row).toMatchObject({
      id: 'a_gmail_com-gcal',
      kind: 'googleCalendar',
      label: 'a@gmail.com',
      includeInDefault: true,
    })
    db.close()
  })
})

// ---------------------------------------------------------------------------
// calendar tests
// ---------------------------------------------------------------------------

describe('calendar', () => {
  it('create and query event in range', () => {
    const db = openMemoryRipmailDb()
    db.prepare(`INSERT INTO sources (id, kind) VALUES ('cal-source', 'googleCalendar')`).run()
    const now = Math.floor(Date.now() / 1000)
    const event = calendarCreateEvent(db, {
      sourceId: 'cal-source',
      calendarId: 'primary',
      summary: 'Team standup',
      startAt: now,
      endAt: now + 3600,
    })
    const r = calendarRange(db, now - 60, now + 7200)
    expect(r.events.some((e) => e.uid === event.uid)).toBe(true)
    calendarDeleteEvent(db, event.uid)
    const r2 = calendarRange(db, now - 60, now + 7200)
    expect(r2.events.some((e) => e.uid === event.uid)).toBe(false)
    db.close()
  })

  it('listCalendars returns distinct calendars', () => {
    const db = openMemoryRipmailDb()
    const now = Math.floor(Date.now() / 1000)
    calendarCreateEvent(db, { sourceId: 's1', calendarId: 'primary', summary: 'A', startAt: now, endAt: now + 3600 })
    calendarCreateEvent(db, { sourceId: 's1', calendarId: 'work', summary: 'B', startAt: now, endAt: now + 3600 })
    calendarCreateEvent(db, { sourceId: 's1', calendarId: 'primary', summary: 'C', startAt: now + 100, endAt: now + 3700 })
    const calendars = calendarListCalendars(db)
    const ids = calendars.map((c) => c.id)
    expect(ids).toContain('primary')
    expect(ids).toContain('work')
    expect(new Set(ids).size).toBe(ids.length) // no duplicates
    db.close()
  })

  it('restrictGoogleCalendarIds filters google rows by calendar_id but keeps other source kinds', () => {
    const db = openMemoryRipmailDb()
    const now = Math.floor(Date.now() / 1000)
    const synced = now
    const ins = db.prepare(`
      INSERT INTO calendar_events
      (source_id, source_kind, calendar_id, uid, summary, start_at, end_at, all_day, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `)
    ins.run('g', 'googleCalendar', 'lew@gmail.com', 'u1', 'Lew', now, now + 3600, synced)
    ins.run('g', 'googleCalendar', 'other@group.calendar.google.com', 'u2', 'OtherCal', now, now + 3600, synced)
    ins.run('apple', 'appleCalendar', 'home', 'u3', 'AppleOnly', now, now + 3600, synced)

    const r = calendarRange(db, now - 60, now + 7200, {
      restrictGoogleCalendarIds: ['lew@gmail.com'],
    })
    const titles = r.events.map((e) => e.summary).sort()
    expect(titles).toEqual(['AppleOnly', 'Lew'])
    db.close()
  })
})

// ---------------------------------------------------------------------------
// draft tests
// ---------------------------------------------------------------------------

describe('draft', () => {
  let tmpHome: string
  let db: RipmailDb
  beforeEach(() => {
    tmpHome = join(tmpdir(), `ripmail-draft-${randomUUID()}`)
    mkdirSync(tmpHome, { recursive: true })
    db = openMemoryRipmailDb()
  })
  afterEach(() => {
    db.close()
    try { rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore cleanup errors */ }
  })

  it('creates and views a draft', () => {
    const d = draftNew(db, tmpHome, {
      to: 'bob@example.com',
      subject: 'Quick question',
      body: 'Ask about the project.',
    })
    expect(d.id).toBeTruthy()
    const viewed = draftView(tmpHome, d.id)
    expect(viewed?.id).toBe(d.id)
    expect(viewed?.to).toContain('bob@example.com')
  })

  it('edits subject and recipient', () => {
    const d = draftNew(db, tmpHome, { to: 'bob@example.com', subject: 'Hi', body: 'Say hello.' })
    const edited = draftEdit(tmpHome, d.id, { subject: 'Custom subject', addCc: ['cc@example.com'] })
    expect(edited.subject).toBe('Custom subject')
    expect(edited.cc).toContain('cc@example.com')
  })

  it('ensures Braintunnel subject marker when braintunnelCollaborator is true', () => {
    const d = draftNew(db, tmpHome, {
      to: 'bob@example.com',
      subject: 'Update',
      body: 'Hi',
      braintunnelCollaborator: true,
    })
    expect(d.subject).toBe('[braintunnel] Update')
  })
})

// ---------------------------------------------------------------------------
// DB file open/reuse test
// ---------------------------------------------------------------------------

describe('openRipmailDb', () => {
  it('creates DB file on first open and reuses on second open', () => {
    const tmpDir = join(tmpdir(), `ripmail-open-${randomUUID()}`)
    mkdirSync(tmpDir, { recursive: true })
    const db1 = openRipmailDb(tmpDir)
    expect(db1.open).toBe(true)
    const db2 = openRipmailDb(tmpDir)
    expect(db1).toBe(db2) // same cached instance
    closeRipmailDb(tmpDir)
    rmSync(tmpDir, { recursive: true, force: true })
  })
})
