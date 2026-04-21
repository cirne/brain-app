import { existsSync, realpathSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export class PathEscapeError extends Error {
  readonly code = 'path_escape'

  constructor(message = 'path_escape') {
    super(message)
    this.name = 'PathEscapeError'
  }
}

function tryReal(path: string): string {
  try {
    return existsSync(path) ? realpathSync(path) : resolve(path)
  } catch {
    return resolve(path)
  }
}

function pathIsStrictlyInsideOrEqual(inner: string, outerReal: string): boolean {
  const innerReal = tryReal(inner)
  const rel = relative(outerReal, innerReal)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')
}

/**
 * Resolve `userSegments` relative to `homeDir` and ensure the result stays inside `homeDir`
 * (symlink-safe when the target exists).
 */
export function resolvePathStrictlyUnderHome(homeDir: string, ...userSegments: string[]): string {
  const baseReal = tryReal(homeDir)
  const candidate = resolve(baseReal, ...userSegments)
  const checked = tryReal(candidate)

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
  const cand = tryReal(absolutePath)
  const roots = [homeDir, ...extraRoots]
  for (const r of roots) {
    try {
      const outer = tryReal(r)
      if (pathIsStrictlyInsideOrEqual(cand, outer)) return true
    } catch {
      continue
    }
  }
  return false
}
