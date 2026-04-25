import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { bundledUserSkillsDir } from '@server/lib/platform/bundledUserSkillsDir.js'
import { skillsDir } from '@server/lib/wiki/wikiDir.js'

export interface SkillListItem {
  /** Directory name / slash id (e.g. `calendar`); use with `load_skill` and `/<slug>`. */
  slug: string
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

/** Slug dirs with a `SKILL.md` under `root` (e.g. user skills or bundled `user-skills`). */
async function listSkillSlugsInRoot(root: string): Promise<string[]> {
  if (!existsSync(root)) return []
  const ents = await readdir(root, { withFileTypes: true })
  const out: string[] = []
  for (const ent of ents) {
    if (!ent.isDirectory()) continue
    if (ent.name.startsWith('.')) continue
    const p = join(root, ent.name, 'SKILL.md')
    if (existsSync(p)) out.push(ent.name)
  }
  return out
}

function skillListItemFromMatter(
  raw: string,
  slug: string,
): { name: string; label: string; description: string; hint?: string; args?: string } {
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
    typeof d.hint === 'string' && d.hint.trim() ? d.hint.trim() : hintFallback(description)
  const args = typeof d.args === 'string' && d.args.trim() ? d.args.trim() : undefined
  return { name, label, description, hint, args }
}

/**
 * User skills in `$BRAIN_HOME/skills/` plus system skills from the shipped bundle (`assets/user-skills`).
 * User `skills/<slug>/` overrides a bundled skill with the same slug.
 */
export async function listSkills(): Promise<SkillListItem[]> {
  const userRoot = skillsDir()
  const userSlugs = await listSkillSlugsInRoot(userRoot)

  const bundleRoot = bundledUserSkillsDir()
  const bundleSlugs = bundleRoot ? await listSkillSlugsInRoot(bundleRoot) : []

  const bySlug = new Set<string>([...userSlugs, ...bundleSlugs])
  if (bySlug.size === 0) return []
  const out: SkillListItem[] = []

  for (const slug of bySlug) {
    const userPath = join(userRoot, slug, 'SKILL.md')
    const path = existsSync(userPath)
      ? userPath
      : bundleRoot
        ? join(bundleRoot, slug, 'SKILL.md')
        : null
    if (!path || !existsSync(path)) continue
    const raw = await readFile(path, 'utf-8')
    const item = skillListItemFromMatter(raw, slug)
    out.push({
      slug,
      name: item.name,
      label: item.label,
      description: item.description,
      hint: item.hint,
      args: item.args,
    })
  }

  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

const SKILL_LIB_DESCRIPTION_MAX = 200

/**
 * Markdown block for the main chat agent system prompt: compact index of installed skills.
 * Empty string when there are no skills.
 */
export async function formatSkillLibrarySection(): Promise<string> {
  const items = await listSkills()
  if (items.length === 0) return ''
  const bullets = items
    .map(
      s =>
        `- **${s.slug}** (${s.name}): ${firstSentence(s.description, SKILL_LIB_DESCRIPTION_MAX)}`,
    )
    .join('\n')
  return `## Available specialized skills

When the user's task clearly matches one of these areas, call **load_skill** with the corresponding \`slug\` (after **set_chat_title** on the first user message of a new topic when you use it) before relying on domain-specific tools or deep workflows. If the full skill text is already in this conversation, do not load it again.

${bullets}
`
}
