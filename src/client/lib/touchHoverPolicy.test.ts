import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Touch devices synthesize :hover on first tap when hover rules exist, stealing the tap.
 * List rows and nav controls scope interactive :hover to `@media (hover: hover)`.
 * Row delete affordances use `@media (hover: none)` to stay visible when hover-reveal is unavailable.
 */
describe('touch hover policy (CSS)', () => {
  it('ChatHistory gates row/delete hovers and reveals delete on touch', () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), '../components/ChatHistory.svelte')
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('@media (hover: hover)')
    expect(src).toContain('@media (hover: none)')
    expect(src).toContain('.ch-row:hover')
    expect(src).toContain('.ch-row-delete')
  })

  it('ChatHistoryPage keeps touch-visible delete affordances and row hover styles', () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), '../components/ChatHistoryPage.svelte')
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('[@media(hover:none)]')
    expect(src).toContain('hover:bg-surface-3')
    expect(src).toContain('chp-row-delete')
  })
})
