/**
 * Wiki `find` tool backend: prefer **`fd --glob --follow`** (same flags as pi-coding-agent
 * plus directory traversal through symlinked mounts, e.g. `wikis/@peer/`), then fall back to
 * {@link wikiVaultGlobViaWalk} when `fd` / `fdfind` is not on PATH.
 *
 * Returns **absolute** paths so pi's `find` custom-glob branch can relativize correctly (its
 * relative-path branch resolves against `process.cwd()` and breaks vault-relative hits).
 */
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { wikiVaultGlobViaWalk } from './wikiVaultSymlinkGlob.js'

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 'ENOENT'
}

/**
 * Relative path from `wikiToolsRoot` to an absolute hit, POSIX with `/`.
 * Uses a **logical** prefix check after `path.relative` so peer hits stay **`@handle/…`**
 * when `path.relative` yields `..` (e.g. fd/`resolve` spelling vs symlink targets on macOS).
 */
export function wikiFindDisplayRelPosixFromToolsRoot(wikiToolsRootAbs: string, absHit: string): string {
  const root = path.resolve(wikiToolsRootAbs)
  const hitNorm = path.normalize(absHit)
  const rel = path.relative(root, hitNorm)
  const relPosix = rel.split(path.sep).join('/')
  if (!relPosix.startsWith('..') && relPosix !== '') return relPosix

  const rootP = root.split(path.sep).join('/')
  const hitP = hitNorm.split(path.sep).join('/')
  const pref = rootP.endsWith('/') ? rootP : `${rootP}/`
  if (hitP === rootP) return ''
  if (hitP.startsWith(pref)) return hitP.slice(pref.length)
  return relPosix
}

const FD_BINS = ['fd', 'fdfind'] as const

let fdBinMemo: string | null | undefined
function resolveFdBinary(): string | null {
  if (fdBinMemo !== undefined) return fdBinMemo
  for (const bin of FD_BINS) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf-8' })
    if (r.error && isEnoent(r.error)) continue
    if (r.status === 0) {
      fdBinMemo = bin
      return bin
    }
  }
  fdBinMemo = null
  return null
}

/** Map pi-coding-agent `find` custom-glob ignores to `fd --exclude` (best-effort). */
function fdExcludeArgs(ignore: readonly string[] | undefined): string[] {
  const out: string[] = []
  if (!ignore?.length) return out
  const seen = new Set<string>()
  for (const g of ignore) {
    const t = g.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push('--exclude', t)
  }
  return out
}

/**
 * @returns Absolute POSIX-ish paths (normalized). Empty when no matches. `null` = do not use fd (missing binary or hard failure).
 */
export function tryWikiFindViaFdFollow(params: {
  pattern: string
  searchPathAbs: string
  limit: number
  ignore?: readonly string[]
  /** When true, glob matching is case-sensitive. Default false — fd uses `--ignore-case`. */
  caseSensitive?: boolean
}): string[] | null {
  const bin = resolveFdBinary()
  if (!bin) return null

  const searchPath = path.resolve(params.searchPathAbs)
  const limit = Math.max(1, params.limit)

  const args: string[] = [
    '--glob',
    '--color=never',
    '--hidden',
    '--no-require-git',
    '--follow',
    '--absolute-path',
    '--max-results',
    String(limit),
    ...fdExcludeArgs(params.ignore),
  ]
  if (params.caseSensitive !== true) {
    args.push('--ignore-case')
  }

  let effectivePattern = params.pattern
  if (params.pattern.includes('/')) {
    args.push('--full-path')
    if (!params.pattern.startsWith('/') && !params.pattern.startsWith('**/') && params.pattern !== '**') {
      effectivePattern = `**/${params.pattern}`
    }
  }

  args.push(effectivePattern, searchPath)

  const r = spawnSync(bin, args, {
    encoding: 'utf-8',
    maxBuffer: 12 * 1024 * 1024,
  })

  if (r.error && isEnoent(r.error)) return null

  // fd: exit 1 = no matches; other non-zero = error → fall back to walk
  if (r.status != null && r.status !== 0 && r.status !== 1) return null

  const raw = r.stdout ?? ''
  const lines = raw
    .split('\n')
    .map((l) => l.replace(/\r$/, '').trim())
    .filter((l) => l.length > 0)

  return lines.map((line) => {
    const rel = wikiFindDisplayRelPosixFromToolsRoot(searchPath, path.normalize(line))
    if (!rel.startsWith('..') && rel !== '') {
      return path.resolve(searchPath, ...rel.split('/'))
    }
    return path.normalize(line)
  })
}

/** Prefer fd+follow; fall back to symlink-aware walk. Always returns absolute paths. */
export async function wikiFindGlobAbsolutePaths(params: {
  pattern: string
  searchPathAbs: string
  limit: number
  ignore?: readonly string[]
  caseSensitive?: boolean
}): Promise<string[]> {
  const fdHits = tryWikiFindViaFdFollow(params)
  if (fdHits !== null) return fdHits

  const rels = await wikiVaultGlobViaWalk({
    pattern: params.pattern,
    searchPathAbs: params.searchPathAbs,
    ...(params.ignore != null ? { ignore: params.ignore } : {}),
    limit: params.limit,
    caseSensitive: params.caseSensitive,
  })
  const root = path.resolve(params.searchPathAbs)
  return rels.map((r) => path.resolve(root, r.replace(/\//g, path.sep)))
}
