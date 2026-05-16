import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { bundledUserSkillsDir } from '@server/lib/platform/bundledUserSkillsDir.js'
import { skillsDir } from '@server/lib/wiki/wikiDir.js'

export function parseLeadingSlashCommand(text: string): { slug: string; args: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const m = trimmed.match(/^\/([a-z0-9_-]+)(?:\s+(.*))?$/s)
  if (!m) return null
  return { slug: m[1], args: (m[2] ?? '').trim() }
}

export async function readSkillMarkdown(
  slug: string,
): Promise<{ body: string; name: string; label?: string } | null> {
  const userPath = join(skillsDir(), slug, 'SKILL.md')
  const path = existsSync(userPath)
    ? userPath
    : (() => {
        const b = bundledUserSkillsDir()
        if (!b) return null
        const p = join(b, slug, 'SKILL.md')
        return existsSync(p) ? p : null
      })()
  if (!path) return null
  const raw = await readFile(path, 'utf-8')
  const { content, data } = matter(raw)
  const d = data as { name?: unknown; label?: unknown }
  const name =
    typeof d.name === 'string' && d.name.trim() ? d.name.trim() : slug
  const label =
    typeof d.label === 'string' && d.label.trim() ? d.label.trim() : undefined
  return { body: content.trim(), name, label }
}

/** Default chat list title when the session has no title yet (skill turns often skip `set_chat_title`). */
export function defaultChatTitleForSkill(opts: {
  slug: string
  name: string
  label?: string
  args: string
}): string {
  const a = opts.args.trim()
  if (opts.label) {
    const L = opts.label.trim()
    if (!a) return L.slice(0, 120)
    const tail = a.length > 52 ? `${a.slice(0, 49)}…` : a
    const combined = `${L} — ${tail}`
    return combined.slice(0, 120)
  }
  const base =
    opts.name && opts.name !== opts.slug
      ? opts.name
      : opts.slug.slice(0, 1).toUpperCase() + opts.slug.slice(1).replace(/-/g, ' ')
  if (!a) return base.slice(0, 120)
  const tail = a.length > 64 ? `${a.slice(0, 61)}…` : a
  return `${base}: ${tail}`.slice(0, 120)
}

export function applySkillPlaceholders(
  body: string,
  ctx: { selection?: string; openFile?: string },
): string {
  let out = body
  out = out.replaceAll('{{open_file}}', ctx.openFile ?? '(none)')
  out = out.replaceAll('{{selection}}', ctx.selection ?? '(none)')
  return out
}

export function buildSkillPromptMessages(slug: string, skillBody: string, args: string): AgentMessage[] {
  const ts = Date.now()
  const instruction = `## Skill: /${slug}\n\nFollow the instructions below for this turn.\n\n---\n\n${skillBody}`
  const user1: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text: instruction }],
    timestamp: ts,
  }
  const tail =
    args.length > 0
      ? args
      : 'The user invoked this skill with no additional text after the slash command. Infer intent from context.'
  const user2: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text: `User message (arguments after /${slug}):\n\n${tail}` }],
    timestamp: ts + 1,
  }
  return [user1, user2]
}
