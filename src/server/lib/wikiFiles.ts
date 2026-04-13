import { readdir } from 'node:fs/promises'
import { join, relative, extname } from 'node:path'

/** Recursively collect all .md file paths relative to `dir`. */
export async function listWikiFiles(dir: string): Promise<string[]> {
  const results: string[] = []

  async function walk(current: string) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (extname(entry.name) === '.md') {
        results.push(relative(dir, full))
      }
    }
  }

  await walk(dir)
  return results.sort()
}
