import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { minimatch } from 'minimatch'
function wikiRelIsUnderPeerShare(relPosix: string): boolean {
  const seg = relPosix.replace(/^\/+/, '').split('/').filter(Boolean)[0]
  return seg != null && seg.startsWith('@')
}

const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**']

/** Walk `searchPathAbs` following symlinks; return paths relative to the search directory (POSIX, no leading `./`). */
export async function wikiVaultGlobViaWalk(params: {
  pattern: string
  searchPathAbs: string
  ignore?: readonly string[]
  limit: number
  /** When true, glob match is case-sensitive. Default false (case-insensitive). */
  caseSensitive?: boolean
}): Promise<string[]> {
  const ignores = [...DEFAULT_IGNORE, ...(params.ignore ?? [])]
  const nocase = params.caseSensitive !== true

  let effective = params.pattern.includes('/') ? params.pattern : `**/${params.pattern}`
  if (
    params.pattern.includes('/') &&
    !params.pattern.startsWith('/') &&
    !params.pattern.startsWith('**/')
  ) {
    effective = `**/${effective}`
  }

  const rootAbs = path.resolve(params.searchPathAbs)
  const rootCanonical = await realpath(rootAbs).catch(() => rootAbs)

  const ignoredRel = (relUnix: string) => {
    const r = relUnix.replace(/\/+$/, '')
    if (r === 'node_modules' || r.startsWith('node_modules/')) return true
    if (r === '.git' || r.startsWith('.git/')) return true
    return ignores.some((g) => minimatch(relUnix, g, { dot: true, nocase: true }))
  }

  const matchesRel = (relUnix: string) =>
    minimatch(relUnix.replace(/^\/+|\/+$/g, ''), effective, {
      dot: true,
      nocase,
    })

  const out: string[] = []
  const visitedDirs = new Set<string>()
  let stop = false

  async function walkDir(displayAbs: string): Promise<void> {
    if (stop || out.length >= params.limit) return

    let dirReal: string
    try {
      dirReal = await realpath(displayAbs)
    } catch {
      return
    }
    const dirKey = dirReal.replace(/\\/g, '/')
    if (visitedDirs.has(dirKey)) return
    visitedDirs.add(dirKey)

    let entries
    try {
      entries = await readdir(displayAbs, { withFileTypes: true })
    } catch {
      return
    }

    for (const ent of entries) {
      if (stop || out.length >= params.limit) break
      const childAbs = path.join(displayAbs, ent.name)

      try {
        const rootRelDisplayed = path.relative(rootCanonical, childAbs).split(path.sep).join('/')
        if (rootRelDisplayed.startsWith('..')) continue
        if (ignoredRel(rootRelDisplayed)) continue

        const ls = await lstat(childAbs)

        const relCandidates: string[] = []
        let relForMatch = rootRelDisplayed
        if (ls.isSymbolicLink()) {
          const rp = await realpath(childAbs).catch(() => null)
          if (rp) {
            const viaTarget = path.relative(rootCanonical, rp).split(path.sep).join('/')
            if (!viaTarget.startsWith('..')) {
              relForMatch = viaTarget
            } else if (wikiRelIsUnderPeerShare(rootRelDisplayed)) {
              // Symlink target can resolve outside grantee root; match by basename (file shares).
              const bn = path.basename(rp).split(path.sep).join('/')
              if (bn.length > 0 && bn !== '.' && bn !== '..') relCandidates.push(bn)
            }
          }
        }

        relCandidates.unshift(relForMatch)

        const st = await stat(childAbs)

        if (st.isDirectory()) {
          await walkDir(childAbs)
          continue
        }

        if (st.isFile() && relCandidates.some((r) => matchesRel(r))) {
          out.push(rootRelDisplayed)
          if (out.length >= params.limit) stop = true
        }
      } catch {
        /* skip unreadable */
      }
    }
  }

  try {
    const st = await stat(rootCanonical).catch(() => null)
    if (!st?.isDirectory()) return []
    await walkDir(rootCanonical)
  } catch {
    return []
  }

  return out
}
