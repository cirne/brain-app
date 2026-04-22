import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'

export interface BundledSkillMeta {
  slug: string
  version: string
  srcDir: string
}

export async function listBundledSkills(bundledRoot: string): Promise<BundledSkillMeta[]> {
  const ents = await readdir(bundledRoot, { withFileTypes: true })
  const out: BundledSkillMeta[] = []
  for (const ent of ents) {
    if (!ent.isDirectory()) continue
    const slug = ent.name
    const skillPath = join(bundledRoot, slug, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    const raw = await readFile(skillPath, 'utf-8')
    const { data } = matter(raw)
    const v = (data as { version?: unknown })?.version
    const version =
      typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '1'
    out.push({ slug, version, srcDir: join(bundledRoot, slug) })
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug))
  return out
}
