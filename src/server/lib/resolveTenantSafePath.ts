import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

export class PathEscapeError extends Error {
  readonly code = 'path_escape'

  constructor(message = 'path_escape') {
    super(message)
    this.name = 'PathEscapeError'
  }
}

/**
 * Best-effort physical path aligned with {@link realpathSync} on the deepest existing ancestor
 * (fixes macOS `/var` vs `/private/var` mismatch when the leaf path does not exist yet).
 */
export function normalizePathThroughExistingAncestors(absolutePath: string): string {
  const resolved = resolve(absolutePath)
  let cur = resolved
  let prev = ''
  while (cur !== prev) {
    prev = cur
    try {
      if (existsSync(cur)) {
        const real = realpathSync(cur)
        const suffix = relative(cur, resolved)
        return suffix ? join(real, suffix) : real
      }
    } catch {
      /* walk up */
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return resolved
}

export function isPathStrictlyInsideOrEqual(inner: string, outer: string): boolean {
  const innerReal = normalizePathThroughExistingAncestors(inner)
  const outerReal = normalizePathThroughExistingAncestors(outer)
  const rel = relative(outerReal, innerReal)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')
}

/**
 * Resolve `userSegments` relative to `homeDir` and ensure the result stays inside `homeDir`
 * (symlink-safe when the target exists).
 */
export function resolvePathStrictlyUnderHome(homeDir: string, ...userSegments: string[]): string {
  const baseReal = normalizePathThroughExistingAncestors(homeDir)
  const candidate = resolve(baseReal, ...userSegments)
  const checked = normalizePathThroughExistingAncestors(candidate)

  const rel = relative(baseReal, checked)
  if (rel.startsWith(`..${sep}`) || rel === '..') {
    throw new PathEscapeError()
  }
  return checked
}

/** True if absolute `absolutePath` lies under `homeDir` or any `extraRoots` directory. */
export function isAbsolutePathAllowedUnderRoots(
  absolutePath: string,
  homeDir: string,
  extraRoots: readonly string[],
): boolean {
  const cand = normalizePathThroughExistingAncestors(absolutePath)
  const roots = [homeDir, ...extraRoots]
  for (const r of roots) {
    try {
      if (isPathStrictlyInsideOrEqual(cand, r)) return true
    } catch {
      continue
    }
  }
  return false
}
