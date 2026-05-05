import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import AnchoredActionMenuHarness from '../test-stubs/AnchoredActionMenuHarness.svelte'

describe('AnchoredActionMenu.svelte', () => {
  it('opens a fixed menu anchored to the trigger', async () => {
    render(AnchoredActionMenuHarness)

    await fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menu', { name: 'Test menu' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBeInTheDocument()
  })
})
