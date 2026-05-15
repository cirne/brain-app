import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attachmentRead,
  extractAttachmentText,
  joinExcelSheetsAsRipmailText,
  normalizeAttachmentLookupKey,
  sanitizeSpreadsheetSectionTitle,
} from './attachments.js'
import { parseSpreadsheetFromText } from '../../client/lib/csvSpreadsheet.js'
import { openMemoryRipmailDb, type RipmailDb } from './db.js'
import { attachmentFixturePath } from './fixtures/attachments/index.js'
import { htmlToAgentMarkdown } from '../lib/htmlToAgentMarkdown.js'

describe('htmlToAgentMarkdown', () => {
  it('converts headings, lists, and links to Markdown', () => {
    const md = htmlToAgentMarkdown(`
      <h1>Title</h1>
      <ul><li>One</li><li><a href="https://example.com/x">two</a></li></ul>
    `)
    expect(md).toContain('# Title')
    expect(md).toMatch(/-\s+One/)
    expect(md).toMatch(/\[two]\(https:\/\/example\.com\/x\)/)
  })

  it('returns empty string for whitespace-only HTML', () => {
    expect(htmlToAgentMarkdown('   \n\t  ')).toBe('')
  })
})

describe('normalizeAttachmentLookupKey', () => {
  it('coerces digit-only strings to 1-based indices', () => {
    expect(normalizeAttachmentLookupKey('1')).toBe(1)
    expect(normalizeAttachmentLookupKey(' 2 ')).toBe(2)
  })

  it('leaves non-numeric attachment names unchanged', () => {
    expect(normalizeAttachmentLookupKey('1.txt')).toBe('1.txt')
    expect(normalizeAttachmentLookupKey('v2')).toBe('v2')
    expect(normalizeAttachmentLookupKey(3)).toBe(3)
  })
})

describe('attachmentRead', () => {
  let db: RipmailDb
  let home: string

  beforeEach(() => {
    db = openMemoryRipmailDb()
    home = mkdtempSync(join(tmpdir(), 'attachment-read-'))
  })

  afterEach(() => {
    db.close()
    rmSync(home, { recursive: true, force: true })
  })

  function seedMessage(mid = '<mid@test>') {
    db.prepare(`
      INSERT INTO messages (message_id, thread_id, folder, uid, from_address, to_addresses,
                            cc_addresses, to_recipients, cc_recipients, subject, date,
                            body_text, raw_path, source_id)
      VALUES (?, ?, 'INBOX', 1, 'a@test', '[]', '[]', '[]', '[]', 'Subj', '2026-01-01', 'body', 'x.eml', 'src')
    `).run(mid, mid)
  }

  it('returns a clear message when stored_path is empty (not EISDIR)', async () => {
    seedMessage()
    db.prepare(
      `INSERT INTO attachments (message_id, filename, mime_type, size, stored_path) VALUES (?, ?, ?, ?, ?)`,
    ).run('<mid@test>', 'x.pdf', 'application/pdf', 1, '')
    const text = await attachmentRead(db, 'mid@test', 'x.pdf', home)
    expect(text).toContain('missing stored path')
    expect(text).not.toMatch(/EISDIR/)
  })

  it('coerces string index "1" for lookup', async () => {
    seedMessage()
    const p = attachmentFixturePath('pdfJsTestPlusminus')
    db.prepare(
      `INSERT INTO attachments (message_id, filename, mime_type, size, stored_path) VALUES (?, ?, ?, ?, ?)`,
    ).run('<mid@test>', 'one.pdf', 'application/pdf', 1, p)
    const text = await attachmentRead(db, 'mid@test', '1', home)
    expect(text.trim().length).toBeGreaterThan(3)
    expect(text).not.toMatch(/attachment not found/)
  })

  it('prefers a readable on-disk row when duplicate filenames exist', async () => {
    seedMessage()
    const p = attachmentFixturePath('pdfJsTestPlusminus')
    db.prepare(
      `INSERT INTO attachments (message_id, filename, mime_type, size, stored_path) VALUES (?, ?, ?, ?, ?)`,
    ).run('<mid@test>', 'dup.pdf', 'application/pdf', 1, '')
    db.prepare(
      `INSERT INTO attachments (message_id, filename, mime_type, size, stored_path) VALUES (?, ?, ?, ?, ?)`,
    ).run('<mid@test>', 'dup.pdf', 'application/pdf', 1, p)
    const text = await attachmentRead(db, 'mid@test', 'dup.pdf', home)
    expect(text.trim().length).toBeGreaterThan(3)
    expect(text).not.toMatch(/EISDIR/)
  })
})

describe('sanitizeSpreadsheetSectionTitle', () => {
  it('folds embedded newlines to spaces', () => {
    expect(sanitizeSpreadsheetSectionTitle('A\nB')).toBe('A B')
    expect(sanitizeSpreadsheetSectionTitle('\r\nQ')).toBe('Q')
  })
})

describe('joinExcelSheetsAsRipmailText', () => {
  it('returns raw CSV only for a single worksheet', () => {
    expect(joinExcelSheetsAsRipmailText(['S1'], ['a,b\n1,2\n'])).toBe('a,b\n1,2')
  })

  it('emits ## Sheet: blocks compatible with parseSpreadsheetFromText', () => {
    const out = joinExcelSheetsAsRipmailText(
      ['Summary', 'Detail'],
      ['h,v\na,1\n', 'x,y\n'],
    )
    expect(out).toContain('## Sheet: Summary')
    expect(out).toContain('## Sheet: Detail')
    const parsed = parseSpreadsheetFromText(out, ',')
    expect(parsed.mode).toBe('multi')
    if (parsed.mode !== 'multi') throw new Error('expected multi-sheet parse')
    expect(parsed.sheets.map((s) => s.name)).toEqual(['Summary', 'Detail'])
    expect(parsed.sheets[0].grid).toMatchObject({ headers: ['h', 'v'], rows: [['a', '1']] })
  })

  it('uses a fallback title when a sheet name sanitizes empty', () => {
    const out = joinExcelSheetsAsRipmailText(['\n', 'Second'], ['1', '2'])
    expect(out).toMatch(/^## Sheet: Sheet 1\b/m)
    const parsed = parseSpreadsheetFromText(out, ',')
    expect(parsed.mode).toBe('multi')
    if (parsed.mode !== 'multi') throw new Error('expected multi-sheet parse')
    expect(parsed.sheets.map((s) => s.name)).toEqual(['Sheet 1', 'Second'])
  })
})

describe('extractAttachmentText', () => {
  it('extracts Markdown-shaped content from HTML fixture', async () => {
    const p = attachmentFixturePath('htmlNewsletter')
    const md = await extractAttachmentText(p, 'text/html')
    expect(md).toContain('# Weekly update')
    expect(md).toMatch(/internal wiki/i)
    expect(md).toContain('https://example.com/docs')
  })

  it('reads POI xlsx as comma-delimited text for spreadsheet parsing', async () => {
    const p = attachmentFixturePath('poiSampleXlsx')
    const md = await extractAttachmentText(
      p,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(md.length).toBeGreaterThan(10)
    expect(md).toContain(',')
    const parsed = parseSpreadsheetFromText(md, ',')
    if (parsed.mode === 'multi') {
      expect(md).toMatch(/^## Sheet:/m)
      expect(parsed.sheets.length).toBeGreaterThan(1)
    } else {
      expect(md).not.toMatch(/^## Sheet:/m)
    }
    expect(parsed.mode === 'single' ? parsed.grid : parsed.sheets[0].grid).not.toHaveProperty(
      'error',
    )
  })

  it('reads POI legacy xls without ## Sheet markers when one worksheet', async () => {
    const p = attachmentFixturePath('poiSampleXls')
    const md = await extractAttachmentText(p, 'application/vnd.ms-excel')
    expect(md.length).toBeGreaterThan(10)
    expect(md).not.toMatch(/^## Sheet:/m)
    expect(parseSpreadsheetFromText(md, ',').mode).toBe('single')
  })

  it('reads POI docx via mammoth HTML and turndown', async () => {
    const p = attachmentFixturePath('poiSampleDocx')
    const md = await extractAttachmentText(
      p,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(md).not.toMatch(/DOCX extraction failed/)
    expect(md).toContain('TEST')
  })

  it('extracts text from pdf.js test PDF', async () => {
    const p = attachmentFixturePath('pdfJsTestPlusminus')
    const md = await extractAttachmentText(p, 'application/pdf')
    expect(md.trim().length).toBeGreaterThan(3)
    expect(md).not.toMatch(/^(\(PDF extraction failed)/)
  })
})
