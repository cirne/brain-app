import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = dirname(fileURLToPath(import.meta.url))

export const ATTACHMENT_FIXTURES = {
  htmlNewsletter: 'fixture-newsletter.html',
  poiSampleXlsx: 'poi-sample.xlsx',
  poiSampleXls: 'poi-sample.xls',
  poiSampleDocx: 'poi-sample.docx',
  pdfJsTestPlusminus: 'pdfjs-test-plusminus.pdf',
} as const

export type AttachmentFixtureName = keyof typeof ATTACHMENT_FIXTURES

export function attachmentFixturePath(name: AttachmentFixtureName): string {
  return join(fixturesDir, ATTACHMENT_FIXTURES[name])
}
