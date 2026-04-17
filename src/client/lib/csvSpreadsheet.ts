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

export function isSpreadsheetDelimitedPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.csv') || lower.endsWith('.tsv')
}
