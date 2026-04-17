import { describe, it, expect } from 'vitest'
import { extensionFromPath, fileViewerKindForPath, FILE_VIEWER_BY_EXTENSION } from './fileViewerKind.js'

describe('fileViewerKind', () => {
  it('maps spreadsheet extensions', () => {
    expect(FILE_VIEWER_BY_EXTENSION.csv).toBe('spreadsheet')
    expect(FILE_VIEWER_BY_EXTENSION.tsv).toBe('spreadsheet')
    expect(FILE_VIEWER_BY_EXTENSION.xlsx).toBe('spreadsheet')
    expect(FILE_VIEWER_BY_EXTENSION.xls).toBe('spreadsheet')
  })

  it('extensionFromPath handles posix paths and case', () => {
    expect(extensionFromPath('/Users/me/Data/foo.CSV')).toBe('csv')
    expect(extensionFromPath('Cirne Sale Analysis Decision Lew.xlsx')).toBe('xlsx')
  })

  it('fileViewerKindForPath returns plaintext for unknown ext', () => {
    expect(fileViewerKindForPath('/tmp/readme.md')).toBe('plaintext')
    expect(fileViewerKindForPath('/tmp/noext')).toBe('plaintext')
  })

  it('fileViewerKindForPath returns spreadsheet for xlsx', () => {
    expect(fileViewerKindForPath('/Volumes/Data/foo.xlsx')).toBe('spreadsheet')
  })
})
