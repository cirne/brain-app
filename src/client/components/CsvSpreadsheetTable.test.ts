import { describe, it, expect } from 'vitest'
import CsvSpreadsheetTable from './CsvSpreadsheetTable.svelte'
import { render, screen } from '@client/test/render.js'

describe('CsvSpreadsheetTable.svelte', () => {
  it('renders headers, cells, and meta line', () => {
    render(CsvSpreadsheetTable, {
      props: {
        headers: ['Name', 'Qty'],
        rows: [
          ['Apple', '3'],
          ['42', 'x'],
        ],
      },
    })

    expect(screen.getByRole('region', { name: /spreadsheet preview/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Qty' })).toBeInTheDocument()
    expect(screen.getByText('Apple')).toBeInTheDocument()
    expect(screen.getByText(/2 data rows · 2 columns/)).toBeInTheDocument()
  })
})
