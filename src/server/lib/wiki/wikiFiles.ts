import { readdir, stat } from 'node:fs/promises'
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

/** Most recently modified `.md` files under `dir` (by filesystem mtime), deduped, newest first. */
export async function recentWikiFilesByMtime(
  dir: string,
  limit: number,
): Promise<{ path: string; date: string }[]> {
  const paths = await listWikiFiles(dir)
  const withMtime = await Promise.all(
    paths.map(async (p) => {
      const full = join(dir, p)
      const s = await stat(full)
      return { path: p, mtimeMs: s.mtimeMs }
    }),
  )
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return withMtime.slice(0, limit).map(({ path, mtimeMs }) => ({
    path,
    date: new Date(mtimeMs).toISOString().slice(0, 10),
  }))
}
