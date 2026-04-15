/**
 * Count markdown wiki pages that count toward "seeded enough" for early exit.
 * Excludes root `me.md` (profile), which exists before substantive seed pages.
 */
function normalizeWikiPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

export function countSeedEligibleWikiPages(paths: readonly string[]): number {
  let n = 0
  for (const p of paths) {
    const norm = normalizeWikiPath(p)
    if (norm === 'me.md') continue
    n++
  }
  return n
}
