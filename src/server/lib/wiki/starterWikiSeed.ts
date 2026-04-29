import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { bundledStarterWikiDir } from '@server/lib/platform/bundledStarterWikiDir.js'

async function copyFileIfMissing(src: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) return false
  await mkdir(dirname(dest), { recursive: true })
  await pipeline(createReadStream(src), createWriteStream(dest))
  return true
}

async function collectFiles(dir: string, base: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await collectFiles(full, base)))
    } else if (ent.isFile()) {
      out.push(relative(base, full))
    }
  }
  return out
}

/**
 * Copies packaged starter wiki files into `wikiRoot` **without overwriting** existing files.
 * Ships an exemplar **`me.md`** (lean, injection-oriented); the onboarding interview may **`edit`** it
 * incrementally; finalize **polishes** (e.g. confidence, gaps) when setup completes (OPP-054).
 */
export async function ensureStarterWikiSeed(wikiRoot: string): Promise<{ copied: string[] }> {
  const bundle = bundledStarterWikiDir()
  if (!bundle) {
    return { copied: [] }
  }

  const bundleStat = await stat(bundle)
  if (!bundleStat.isDirectory()) {
    return { copied: [] }
  }

  const rels = await collectFiles(bundle, bundle)
  const copied: string[] = []
  for (const rel of rels.sort()) {
    const from = join(bundle, rel)
    const to = join(wikiRoot, rel)
    const did = await copyFileIfMissing(from, to)
    if (did) copied.push(rel.replace(/\\/g, '/'))
  }
  return { copied }
}
