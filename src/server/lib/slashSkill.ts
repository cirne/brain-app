import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { skillsDir } from './wikiDir.js'

export function parseLeadingSlashCommand(text: string): { slug: string; args: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const m = trimmed.match(/^\/([a-z0-9_-]+)(?:\s+(.*))?$/s)
  if (!m) return null
  return { slug: m[1], args: (m[2] ?? '').trim() }
}

export async function readSkillMarkdown(
  slug: string,
): Promise<{ body: string; name: string } | null> {
  const path = join(skillsDir(), slug, 'SKILL.md')
  if (!existsSync(path)) return null
  const raw = await readFile(path, 'utf-8')
  const { content, data } = matter(raw)
  const d = data as { name?: unknown }
  const name =
    typeof d.name === 'string' && d.name.trim() ? d.name.trim() : slug
  return { body: content.trim(), name }
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
