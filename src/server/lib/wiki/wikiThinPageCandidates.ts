import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Pages shorter than this (word count) in typed folders are deepen candidates. Tune via OPP-067. */
export const THIN_PAGE_MAX_WORDS = 120

/** If `## Chat capture` is present and the page is still under this word count, prioritize deepening. */
export const CHAT_CAPTURE_STUB_MAX_WORDS = 200

const CHAT_CAPTURE_RE = /^##\s+Chat\s+capture\b/im

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').trim()
}

/**
 * True when `relPath` is a candidate folder markdown file (not templates, not vault-root hub/profile files).
 */
export function isThinCandidatePath(relPath: string): boolean {
  const p = normalizeRel(relPath)
  const lower = p.toLowerCase()
  if (!lower.endsWith('.md')) return false
  if (lower.endsWith('template.md')) return false
  if (lower === 'me.md' || lower === 'assistant.md' || lower === 'index.md') return false
  return /^(people|projects|topics)\/.+\.md$/i.test(p)
}

function wordCount(body: string): number {
  return body
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

/**
 * List vault-relative paths under `people/`, `projects/`, `topics/` that look thin or chat-stubbed.
 */
export async function listThinWikiPageCandidates(
  wikiRoot: string,
  manifestPaths: readonly string[],
): Promise<string[]> {
  const out: string[] = []
  for (const rel of manifestPaths) {
    if (!isThinCandidatePath(rel)) continue
    try {
      const body = await readFile(join(wikiRoot, rel), 'utf8')
      const words = wordCount(body)
      const hasChatCapture = CHAT_CAPTURE_RE.test(body)
      const thin = words < THIN_PAGE_MAX_WORDS || (hasChatCapture && words < CHAT_CAPTURE_STUB_MAX_WORDS)
      if (thin) out.push(normalizeRel(rel))
    } catch {
      /* missing or unreadable — skip */
    }
  }
  return out
}

/** Recent edit paths first (from `wiki-edits.jsonl`), then thin candidates; dedupe; max `cap` entries. */
export function mergeWikiDeepenPriorityPaths(
  recentPaths: readonly string[],
  thinPaths: readonly string[],
  cap: number,
): string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const p of recentPaths) {
    const n = normalizeRel(p)
    if (!n.endsWith('.md')) continue
    if (seen.has(n)) continue
    seen.add(n)
    merged.push(n)
    if (merged.length >= cap) return merged
  }
  for (const p of thinPaths) {
    const n = normalizeRel(p)
    if (seen.has(n)) continue
    seen.add(n)
    merged.push(n)
    if (merged.length >= cap) return merged
  }
  return merged
}
