import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listWikiFiles } from './wikiFiles.js'

/**
 * Search markdown files under `dir` for a case-insensitive substring match (content only).
 * Returns paths relative to `dir`, sorted. No shelling out — safe for arbitrary `query` strings.
 */
export async function searchWikiMarkdownPaths(dir: string, query: string): Promise<string[]> {
  const q = query.trim()
  if (!q) return []
  const needle = q.toLowerCase()
  const paths = await listWikiFiles(dir)
  const matches: string[] = []
  for (const rel of paths) {
    const abs = join(dir, rel)
    try {
      const text = await readFile(abs, 'utf-8')
      if (text.toLowerCase().includes(needle)) {
        matches.push(rel)
      }
    } catch {
      /* unreadable — skip */
    }
  }
  matches.sort()
  return matches
}
