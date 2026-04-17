import { describe, it, expect } from 'vitest'
import {
  parseSpreadsheetFromText,
  splitRipmailSheetSections,
  parseDelimitedToGrid,
} from './csvSpreadsheet.js'

describe('splitRipmailSheetSections', () => {
  it('returns single section when no ## Sheet: markers', () => {
    const s = splitRipmailSheetSections('a,b\n1,2')
    expect(s).toEqual([{ name: 'Sheet', body: 'a,b\n1,2' }])
  })

  it('splits multi-sheet ripmail xlsx text', () => {
    const text = `## Sheet: Summary

h1,h2
1,2

## Sheet: Detail

x,y
3,4
`
    const s = splitRipmailSheetSections(text)
    expect(s).toHaveLength(2)
    expect(s[0].name).toBe('Summary')
    expect(s[0].body.trim()).toBe('h1,h2\n1,2')
    expect(s[1].name).toBe('Detail')
    expect(s[1].body.trim()).toBe('x,y\n3,4')
  })
})

describe('parseSpreadsheetFromText', () => {
  it('parses single block as one grid', () => {
    const r = parseSpreadsheetFromText('Name,Val\nA,1', ',')
    expect(r.mode).toBe('single')
    if (r.mode !== 'single') return
    expect('error' in r.grid).toBe(false)
    if ('error' in r.grid) return
    expect(r.grid.headers).toEqual(['Name', 'Val'])
    expect(r.grid.rows).toEqual([['A', '1']])
  })

  it('parses multi-sheet into mode multi', () => {
    const text = `## Sheet: S1

a,b
1,2

## Sheet: S2

c,d
3,4
`
    const r = parseSpreadsheetFromText(text, ',')
    expect(r.mode).toBe('multi')
    if (r.mode !== 'multi') return
    expect(r.sheets).toHaveLength(2)
    expect(r.sheets[0].name).toBe('S1')
    expect('headers' in r.sheets[0].grid && r.sheets[0].grid.headers[0]).toBe('a')
  })
})

describe('parseDelimitedToGrid', () => {
  it('parses comma with quoted fields', () => {
    const g = parseDelimitedToGrid('"hello, world",x', ',')
    expect('error' in g).toBe(false)
    if ('error' in g) return
    expect(g.headers).toEqual(['hello, world', 'x'])
  })
})
