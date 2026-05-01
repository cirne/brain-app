/**
 * Helpers for `scripts/generate-release-notes.ts` (deploy pipeline release notes).
 */

/**
 * From `git tag --list 'deploy-*' --sort=-version:refname` (newest first),
 * return the previous deploy tag relative to the tag being created (`currentTag`).
 */
export function pickPreviousDeployTag(sortedTagsNewestFirst: string[], currentTag: string): string | null {
  for (const t of sortedTagsNewestFirst) {
    const trimmed = t.trim()
    if (!trimmed || trimmed === currentTag) continue
    return trimmed
  }
  return null
}
