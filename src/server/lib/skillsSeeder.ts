import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { skillsDir } from './wikiDir.js'
import { bundledUserSkillsDir } from './bundledUserSkillsDir.js'

async function readJsonOrEmpty(path: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(path, 'utf-8')
    const j = JSON.parse(raw) as unknown
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v
      }
      return out
    }
  } catch {
    /* missing */
  }
  return {}
}

async function writeJson(path: string, data: Record<string, string>): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

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

/**
 * Copy shipped defaults into `<WIKI_DIR>/skills/` once per version; never overwrite existing dirs;
 * do not re-seed after user deletion (see .seeded.json contract in OPP-010).
 */
export async function ensureDefaultSkillsSeeded(): Promise<void> {
  const bundledRoot = bundledUserSkillsDir()
  if (!bundledRoot) {
    console.warn('[brain-app] skills: bundled user-skills not found; skipping seed')
    return
  }

  let skillsRoot: string
  try {
    skillsRoot = skillsDir()
    await mkdir(skillsRoot, { recursive: true })
  } catch (e) {
    console.warn('[brain-app] skills: could not create skills directory:', e)
    return
  }

  const marker = join(skillsRoot, '.seeded.json')
  const seeded = await readJsonOrEmpty(marker)

  let defaults: BundledSkillMeta[]
  try {
    defaults = await listBundledSkills(bundledRoot)
  } catch (e) {
    console.warn('[brain-app] skills: could not list bundled skills:', e)
    return
  }

  for (const { slug, version, srcDir } of defaults) {
    const alreadySeededThisVersion = seeded[slug] === version
    const target = join(skillsRoot, slug)
    const targetExists = existsSync(target)

    if (targetExists) {
      seeded[slug] = version
      continue
    }

    if (alreadySeededThisVersion) continue

    try {
      await cp(srcDir, target, { recursive: true })
      seeded[slug] = version
    } catch (e) {
      console.warn(`[brain-app] skills: could not seed ${slug}:`, e)
    }
  }

  try {
    await writeJson(marker, seeded)
  } catch (e) {
    console.warn('[brain-app] skills: could not write .seeded.json:', e)
  }
}
