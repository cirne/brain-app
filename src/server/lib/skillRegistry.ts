import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { skillsDir } from './wikiDir.js'

export interface SkillListItem {
  name: string
  label: string
  description: string
  hint?: string
  args?: string
}

function firstSentence(s: string, maxLen: number): string {
  const t = s.trim()
  if (!t) return ''
  const end = t.search(/[.!?]\s/)
  const first = end >= 0 ? t.slice(0, end + 1) : t
  return first.length > maxLen ? `${first.slice(0, maxLen - 1)}…` : first
}

function hintFallback(description: string): string | undefined {
  const h = firstSentence(description, 60)
  return h || undefined
}

/**
 * Skills present under `$BRAIN_HOME/skills/<slug>/SKILL.md` for the slash menu and GET /api/skills.
 */
export async function listSkills(): Promise<SkillListItem[]> {
  const root = skillsDir()
  if (!existsSync(root)) return []

  const ents = await readdir(root, { withFileTypes: true })
  const out: SkillListItem[] = []

  for (const ent of ents) {
    if (!ent.isDirectory()) continue
    if (ent.name.startsWith('.')) continue
    const slug = ent.name
    const path = join(root, slug, 'SKILL.md')
    if (!existsSync(path)) continue
    const raw = await readFile(path, 'utf-8')
    const { data } = matter(raw)
    const d = data as {
      name?: unknown
      label?: unknown
      description?: unknown
      hint?: unknown
      args?: unknown
    }
    const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : slug
    const description =
      typeof d.description === 'string' && d.description.trim()
        ? d.description.trim()
        : 'No description.'
    const label = typeof d.label === 'string' && d.label.trim() ? d.label.trim() : name
    const hint =
      typeof d.hint === 'string' && d.hint.trim()
        ? d.hint.trim()
        : hintFallback(description)
    const args = typeof d.args === 'string' && d.args.trim() ? d.args.trim() : undefined

    out.push({ name, label, description, hint, args })
  }

  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
