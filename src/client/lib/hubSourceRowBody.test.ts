import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Hub hub-source rows share `HubSourceRowBody.svelte` — avoid duplicating grid markup in BrainHubPage. */
describe('HubSourceRowBody', () => {
  const comp = join(dirname(fileURLToPath(import.meta.url)), '../components')

  it('defines the shared grid layout in one place', () => {
    const src = readFileSync(join(comp, 'HubSourceRowBody.svelte'), 'utf8')
    expect(src).toContain('hub-source-row-body')
    expect(src).toContain('grid-template-columns: auto 1fr')
    expect(src).toMatch(/@render\s+icon\(\)/)
  })

  it('BrainHubPage uses the component instead of inline source-folder-text', () => {
    const hub = readFileSync(join(comp, 'BrainHubPage.svelte'), 'utf8')
    expect(hub).toContain("import HubSourceRowBody from './HubSourceRowBody.svelte'")
    expect(hub).toContain('<HubSourceRowBody')
    expect(hub).not.toContain('class="source-folder-text"')
  })
})
