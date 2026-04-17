import Papa from 'papaparse'

export type CsvGrid = { headers: string[]; rows: string[][] }

/**
 * Parse delimited text into a header row + body rows for a spreadsheet-style table.
 * First row is treated as column headers.
 */
export function parseDelimitedToGrid(text: string, delimiter: string): CsvGrid | { error: string } {
  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
    delimiter,
    transform: (v) => (v == null ? '' : String(v)),
  })
  const fatal = parsed.errors.find((e) => e.type === 'Quotes' || e.type === 'Delimiter')
  if (fatal) {
    return { error: fatal.message ?? 'Could not parse CSV' }
  }
  const data = parsed.data.filter((row) => row.some((c) => String(c).trim() !== ''))
  if (data.length === 0) {
    return { headers: [], rows: [] }
  }
  const colCount = Math.max(...data.map((r) => r.length), 0)
  const pad = (r: string[]) => {
    const x = r.map((c) => (c == null ? '' : String(c)))
    while (x.length < colCount) x.push('')
    return x.slice(0, colCount)
  }
  const first = pad(data[0])
  const headers = first.map((h, i) => {
    const t = h.trim()
    return t || `Column ${i + 1}`
  })
  const rows = data.slice(1).map((r) => pad(r))
  return { headers, rows }
}

export function spreadsheetDelimiterForPath(path: string): ',' | '\t' {
  return path.toLowerCase().endsWith('.tsv') ? '\t' : ','
}

/**
 * True when the cell string parses as a finite number (optional thousands commas).
 * Used for right-aligned numeric columns in the spreadsheet viewer.
 */
export function isSpreadsheetNumericCell(value: string): boolean {
  const t = value.trim()
  if (t === '') return false
  const normalized = t.replace(/,/g, '')
  if (normalized === '-' || normalized === '.') return false
  const n = Number(normalized)
  return Number.isFinite(n) && normalized.length > 0
}

/**
 * ripmail `read` turns `.xlsx` / `.xls` into CSV text; multiple sheets use:
 * `## Sheet: Name\n\n<csv body>` (see ripmail `xlsx_to_csv`).
 * Single-sheet workbooks omit the `## Sheet:` header.
 */
export function splitRipmailSheetSections(text: string): { name: string; body: string }[] {
  const t = text.trim()
  if (!/^## Sheet:/m.test(t)) {
    return [{ name: 'Sheet', body: t }]
  }
  const parts = t.split(/\n(?=## Sheet:)/)
  return parts.map((part, i) => {
    const m = part.match(/^## Sheet:\s*(.+?)(?:\r?\n)([\s\S]*)$/s)
    if (m) {
      return { name: m[1].trim(), body: m[2].trim() }
    }
    const m2 = part.match(/^## Sheet:\s*(.+)$/s)
    if (m2) {
      return { name: m2[1].trim(), body: '' }
    }
    return { name: `Sheet ${i + 1}`, body: part.trim() }
  })
}

export type SpreadsheetParseResult =
  | { mode: 'single'; grid: CsvGrid | { error: string } }
  | {
      mode: 'multi'
      sheets: { name: string; grid: CsvGrid | { error: string } }[]
    }

/** Parse CSV/TSV body or ripmail’s multi-sheet xlsx text into one or more grids. */
export function parseSpreadsheetFromText(
  text: string,
  delimiter: ',' | '\t',
): SpreadsheetParseResult {
  const sections = splitRipmailSheetSections(text)
  if (sections.length === 1) {
    return { mode: 'single', grid: parseDelimitedToGrid(sections[0].body, delimiter) }
  }
  return {
    mode: 'multi',
    sheets: sections.map((s) => ({
      name: s.name,
      grid: parseDelimitedToGrid(s.body, delimiter),
    })),
  }
}
