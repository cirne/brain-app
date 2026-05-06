import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { WIKIS_ME_SEGMENT } from '@server/lib/platform/brainLayout.js'

/** Resolve unified `wikis/` vs personal vault root when callers pass either layout. */
function unifiedAndVaultRoots(wikiHomeAbs: string): { unifiedRoot: string; vaultRoot: string } {
  const norm = wikiHomeAbs.replace(/[/\\]+$/, '')
  if (basename(norm) === WIKIS_ME_SEGMENT) {
    return { unifiedRoot: dirname(norm), vaultRoot: norm }
  }
  return { unifiedRoot: norm, vaultRoot: join(norm, WIKIS_ME_SEGMENT) }
}

/**
 * Rewrite `open` tool wiki targets so the client hits the right surface (`me/` vs `@peer/`).
 * `wikiHomeAbs` may be the **unified** `wikis/` directory **or** the personal vault **`wikis/me/`** — both resolve the same way.
 * - Bare paths (`travel/x.md`) that exist only under **`me/`** become `me/travel/x.md`.
 * - Paths that exist only under **one** `wikis/@handle/` projection become `@handle/travel/x.md`.
 * - Wrong `me/…` when the file is only on a peer → **`@handle/…`**.
 * - Leaves **ambiguous** cases (same relpath in me and ≥1 peer, or multiple peers) unchanged.
 */
export function rewriteOpenWikiTargetForUnifiedTree(
  wikiHomeAbs: string,
  target: unknown,
): unknown {
  if (target == null || typeof target !== 'object' || !('type' in target)) return target
  const t = target as { type?: unknown; path?: unknown; shareHandle?: unknown }
  if (t.type !== 'wiki' || typeof t.path !== 'string') return target

  const pathTrim = t.path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (!pathTrim) return target

  const parts = pathTrim.split('/').filter(Boolean)
  const first = parts[0] ?? ''
  if (first.startsWith('@')) return target

  let rel: string
  if (first === 'me') {
    rel = parts.slice(1).join('/')
  } else {
    rel = pathTrim
  }
  if (!rel) return target

  const { unifiedRoot: toolsRoot, vaultRoot } = unifiedAndVaultRoots(wikiHomeAbs)
  const personalAbs = join(vaultRoot, rel)
  const personalOk = existsSync(personalAbs)

  let peerDirs: string[]
  try {
    peerDirs = readdirSync(toolsRoot).filter((e) => e.startsWith('@'))
  } catch {
    return target
  }

  const peerHits: string[] = []
  for (const pd of peerDirs) {
    try {
      if (existsSync(join(toolsRoot, pd, rel))) peerHits.push(pd)
    } catch {
      /* skip */
    }
  }

  if (personalOk && peerHits.length > 0) {
    return target
  }

  let newRelPath: string
  if (personalOk && peerHits.length === 0) {
    newRelPath = `me/${rel}`
  } else if (!personalOk && peerHits.length === 1) {
    newRelPath = `${peerHits[0]}/${rel}`
  } else {
    return target
  }

  if (newRelPath === pathTrim) return target

  const shareHandle =
    typeof t.shareHandle === 'string' && t.shareHandle.trim().length > 0 ? t.shareHandle.trim() : undefined

  return {
    ...t,
    type: 'wiki' as const,
    path: newRelPath,
    ...(shareHandle ? { shareHandle } : {}),
  }
}

export function rewriteOpenToolArgsIfNeeded(wikiHomeAbs: string, args: unknown): unknown {
  if (args == null || typeof args !== 'object' || !('target' in args)) return args
  const a = args as { target?: unknown }
  const newTarget = rewriteOpenWikiTargetForUnifiedTree(wikiHomeAbs, a.target)
  if (newTarget === a.target) return args
  return { ...a, target: newTarget }
}
