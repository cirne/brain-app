import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Desktop detail SlideOver must not duplicate AppTopNav search/sync (see Assistant.svelte).
 * Mobile full-screen slide may still pass onSync so actions are available in the panel header.
 */
describe('OnboardingWorkspace SlideOver toolbar', () => {
  it('does not pass onSync into desktop detail SlideOver', () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../components/onboarding/OnboardingWorkspace.svelte',
    )
    const src = readFileSync(path, 'utf8')
    const desktop = src.match(/\{#snippet desktopDetail\(\)\}([\s\S]*?)\{\/snippet\}/)?.[1]
    expect(desktop).toBeDefined()
    expect(desktop!).not.toMatch(/onSync/)
  })
})
