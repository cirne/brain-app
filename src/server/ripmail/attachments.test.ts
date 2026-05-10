import { describe, expect, it } from 'vitest'
import { extractAttachmentText } from './attachments.js'
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

describe('extractAttachmentText', () => {
  it('extracts Markdown-shaped content from HTML fixture', async () => {
    const p = attachmentFixturePath('htmlNewsletter')
    const md = await extractAttachmentText(p, 'text/html')
    expect(md).toContain('# Weekly update')
    expect(md).toMatch(/internal wiki/i)
    expect(md).toContain('https://example.com/docs')
  })

  it('reads POI xlsx into sheet sections', async () => {
    const p = attachmentFixturePath('poiSampleXlsx')
    const md = await extractAttachmentText(
      p,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(md).toMatch(/^## /m)
    expect(md).toContain(',')
  })

  it('reads POI legacy xls', async () => {
    const p = attachmentFixturePath('poiSampleXls')
    const md = await extractAttachmentText(p, 'application/vnd.ms-excel')
    expect(md).toMatch(/^## /m)
    expect(md.length).toBeGreaterThan(10)
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
