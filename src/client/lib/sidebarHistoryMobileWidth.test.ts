import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

describe('mobile chat history drawer width', () => {
  it('uses 90vw token in global CSS and Assistant', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')
    const style = readFileSync(join(root, 'style.css'), 'utf8')
    expect(style).toMatch(/--sidebar-history-mobile-w:\s*90vw/)
    const assistant = readFileSync(join(root, 'components/Assistant.svelte'), 'utf8')
    expect(assistant).toMatch(/sidebar-history-mobile\b/)
  })
})
