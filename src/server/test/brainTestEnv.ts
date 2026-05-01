/**
 * Vitest (server project): ensure `BRAIN_DATA_ROOT` exists before modules call `dataRoot()`.
 * Set a default `BRAIN_HOME` for tests that import code using `brainHome()` without tenant ALS
 * (see `brainHome()` test-only legacy branch in `brainHome.ts`).
 * Individual tests may override; restore in `afterEach` when needed.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env.BRAIN_DATA_ROOT?.trim()) {
  process.env.BRAIN_DATA_ROOT = mkdtempSync(join(tmpdir(), 'vitest-brain-data-root-'))
}
if (!process.env.BRAIN_HOME?.trim()) {
  process.env.BRAIN_HOME = mkdtempSync(join(tmpdir(), 'vitest-brain-home-'))
}
