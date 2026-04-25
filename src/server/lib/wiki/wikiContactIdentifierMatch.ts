import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { canonicalizeImessageChatIdentifier, normalizePhoneDigits, phoneToFlexibleGrepPattern } from '@server/lib/apple/imessagePhone.js'

/**
 * Markdown bodies of "## Contact" / "## Identifiers" sections (any heading level, case-insensitive title).
 * Used to associate a Messages chat_identifier with wiki pages without scanning whole files.
 */
export function extractContactOrIdentifiersSectionBodies(markdown: string): string[] {
  const lines = markdown.split('\n')
  const bodies: string[] = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^(#{1,6})\s+(Contact|Identifiers)\s*$/i)
    if (m) {
      const level = m[1].length
      i++
      const chunk: string[] = []
      while (i < lines.length) {
        const hm = lines[i].match(/^(#{1,6})\s+/)
        if (hm && hm[1].length <= level) break
        chunk.push(lines[i])
        i++
      }
      bodies.push(chunk.join('\n'))
      continue
    }
    i++
  }
  return bodies
}

function contactBodiesConcat(markdown: string): string {
  return extractContactOrIdentifiersSectionBodies(markdown).join('\n\n')
}

export function contactSectionMatchesChatIdentifier(sectionText: string, canonicalChatId: string): boolean {
  const id = canonicalizeImessageChatIdentifier(canonicalChatId).trim()
  if (!id) return false
  if (id.includes('@')) {
    return sectionText.toLowerCase().includes(id.toLowerCase())
  }
  const digits = normalizePhoneDigits(id)
  if (digits) {
    try {
      const re = new RegExp(phoneToFlexibleGrepPattern(digits))
      return re.test(sectionText)
    } catch {
      return false
    }
  }
  return false
}

/** One pass: relative path → combined Contact/Identifiers section text only. */
export async function loadWikiContactSectionBodiesByPath(wikiRoot: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        await walk(full)
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        try {
          const st = await stat(full)
          if (!st.isFile()) continue
          const raw = await readFile(full, 'utf8')
          const body = contactBodiesConcat(raw)
          if (!body.trim()) continue
          const rel = relative(wikiRoot, full).replace(/\\/g, '/')
          map.set(rel, body)
        } catch {
          /* skip */
        }
      }
    }
  }
  await walk(wikiRoot)
  return map
}

export function wikiPathsMatchingChatInContactSections(
  contactBodiesByPath: Map<string, string>,
  canonicalChatId: string,
): string[] {
  const out: string[] = []
  for (const [relPath, body] of contactBodiesByPath) {
    if (contactSectionMatchesChatIdentifier(body, canonicalChatId)) out.push(relPath)
  }
  return out.sort()
}
