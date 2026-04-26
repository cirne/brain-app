import { describe, it, expect } from 'vitest'
import FullDiskAccessGateHarness from '../test-stubs/FullDiskAccessGateHarness.svelte'
import { render, screen } from '@client/test/render.js'

describe('FullDiskAccessGate.svelte', () => {
  it('renders children when the FDA gate does not apply (dev / non-Tauri)', () => {
    render(FullDiskAccessGateHarness)
    expect(screen.getByTestId('fda-child')).toHaveTextContent('Gated app surface')
    expect(screen.queryByRole('dialog', { name: /allow full disk access/i })).not.toBeInTheDocument()
  })
})
