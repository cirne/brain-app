import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../styles/onboarding/onboardingActivityTranscript.css',
)

describe('onboardingActivityTranscript.css (profiling / seeding transcript layout)', () => {
  it('keeps tool hint aligned with activity text column (pulse + gap)', () => {
    const css = readFileSync(cssPath, 'utf8')
    expect(css).toMatch(
      /\.ob-prof-tool-hint\s*\{[^}]*padding-left:\s*calc\(\s*6px\s*\+\s*0\.5rem\s*\)/s,
    )
  })

  it('gives activity row explicit vertical margin for rhythm below lead', () => {
    const css = readFileSync(cssPath, 'utf8')
    expect(css).toMatch(/\.ob-prof-activity\s*\{[^}]*margin:\s*0\.75rem\s+0\s+0\.75rem/s)
  })
})
