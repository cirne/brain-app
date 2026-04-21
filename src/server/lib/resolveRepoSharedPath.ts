import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolve a file under the repo `shared/` directory in production and dev.
 *
 * **Order (root cause–friendly, no deep `../` chains beyond one fixed fallback):**
 * 1. **`shared/<segment>` next to the server bundle** — `dist/server/shared/` after `npm run build`
 *    (`import.meta.url` is `dist/server/index.js`; sibling `shared/` is copied there by the build).
 * 2. **Repo `shared/` from `src/server/lib/**`** — three segments up from this file’s directory
 *    (Vitest / non-bundled runs).
 * 3. **`process.cwd()/shared/`** — e.g. `npm run dev` with cwd at repo root.
 */
export function resolveRepoSharedPath(segment: string): string {
  const p = tryResolveRepoSharedPath(segment)
  if (p) return p
  throw new Error(
    `shared/${segment} not found (expected dist/server/shared/${segment} next to the bundle, or repo shared/ when running from source)`,
  )
}

/** Same search as {@link resolveRepoSharedPath}, but returns null if missing. */
export function tryResolveRepoSharedPath(segment: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'shared', segment),
    join(here, '..', '..', '..', 'shared', segment),
    join(process.cwd(), 'shared', segment),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}
