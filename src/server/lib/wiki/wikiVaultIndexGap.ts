import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ripmailWho } from '@server/ripmail/index.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { listWikiFiles } from '@server/lib/wiki/wikiFiles.js'
import type { WikiSaturationLedgerDoc } from '@server/lib/wiki/wikiSaturationLedger.js'
import { getSaturationEntry } from '@server/lib/wiki/wikiSaturationLedger.js'
import { WIKI_SATURATION_MIN_INDEXED_DELTA } from '@shared/wikiLap.js'

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').trim().replace(/^\.\/+/, '').replace(/^\/+/, '')
}

/** Build a set of manifest paths for resolution (lowercase). */
function manifestIndex(manifest: readonly string[]): Set<string> {
  const s = new Set<string>()
  for (const p of manifest) {
    const n = normalizeRel(p).toLowerCase()
    s.add(n)
    if (n.endsWith('.md')) {
      s.add(n.slice(0, -3))
    } else {
      s.add(`${n}.md`)
    }
  }
  return s
}

function targetExists(index: Set<string>, raw: string): boolean {
  const t = raw.trim()
  if (!t) return true
  const noAnchor = t.split('#')[0] ?? t
  const n = normalizeRel(noAnchor).toLowerCase()
  const candidates = new Set<string>()
  candidates.add(n)
  candidates.add(n.endsWith('.md') ? n : `${n}.md`)
  if (!n.includes('/')) {
    for (const pre of ['people', 'projects', 'topics', 'travel', 'notes']) {
      candidates.add(`${pre}/${n}`)
      candidates.add(`${pre}/${n}.md`)
    }
  }
  for (const c of candidates) {
    if (index.has(c) || index.has(c.replace(/\.md$/, ''))) return true
  }
  return false
}

export type BrokenWikilink = {
  target: string
  /** Example vault file containing the link */
  sourcePath: string
}

export async function listBrokenVaultWikilinks(wikiRoot: string, manifest: readonly string[]): Promise<BrokenWikilink[]> {
  const index = manifestIndex(manifest)
  const broken: BrokenWikilink[] = []
  const seen = new Set<string>()

  for (const rel of manifest) {
    if (!rel.toLowerCase().endsWith('.md')) continue
    if (rel.toLowerCase().endsWith('template.md')) continue
    let body: string
    try {
      body = await readFile(join(wikiRoot, rel), 'utf-8')
    } catch {
      continue
    }
    let m: RegExpExecArray | null
    WIKILINK_RE.lastIndex = 0
    while ((m = WIKILINK_RE.exec(body)) !== null) {
      const target = m[1]?.trim() ?? ''
      if (!target || target.startsWith('http')) continue
      if (targetExists(index, target)) continue
      const key = `${rel}::${target}`
      if (seen.has(key)) continue
      seen.add(key)
      broken.push({ target, sourcePath: rel })
    }
  }
  return broken
}

export type TopContactWikiGap = {
  /** Display label or email from ripmail who */
  label: string
  /** Suggested kebab slug if a people page were added */
  suggestedPath?: string
}

/**
 * Contacts from `ripmail who` with no matching `people/*.md` (heuristic: slug from display name).
 */
export async function listTopContactsMissingPeoplePage(
  wikiRoot: string,
  opts: { limit?: number } = {},
): Promise<TopContactWikiGap[]> {
  const limit = opts.limit ?? 25
  let whoJson: Awaited<ReturnType<typeof ripmailWho>>
  try {
    whoJson = await ripmailWho(ripmailHomeForBrain(), undefined, { limit: 60 })
  } catch {
    return []
  }
  const manifest = await listWikiFiles(wikiRoot)
  const people = manifest.filter((p) => /^people\/.+\.md$/i.test(p.replace(/\\/g, '/')))
  const peopleSlugs = new Set(
    people.map((p) => {
      const base = p.replace(/^people\//i, '').replace(/\.md$/i, '').toLowerCase()
      return base
    }),
  )

  const contacts = whoJson?.contacts ?? []
  const out: TopContactWikiGap[] = []
  for (const c of contacts) {
    const name =
      typeof c.displayName === 'string' && c.displayName.trim()
        ? c.displayName.trim()
        : c.primaryAddress?.trim() ?? ''
    if (!name) continue
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
    if (!slug) continue
    if (peopleSlugs.has(slug)) continue
    const email = typeof c.primaryAddress === 'string' ? c.primaryAddress.toLowerCase() : ''
    const emailSlug = email
      .split('@')[0]
      ?.replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (emailSlug && peopleSlugs.has(emailSlug)) continue

    out.push({
      label: name,
      suggestedPath: slug ? `people/${slug}.md` : undefined,
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Format server-side gap summary for survey injection (markdown).
 */
export async function buildWikiVaultGapContextBlock(wikiRoot: string, ledger: WikiSaturationLedgerDoc): Promise<string> {
  const manifest = await listWikiFiles(wikiRoot)
  const broken = await listBrokenVaultWikilinks(wikiRoot, manifest)
  const contacts = await listTopContactsMissingPeoplePage(wikiRoot, { limit: 20 })

  const saturatedLines: string[] = []
  for (const rel of manifest) {
    if (!/^(people|projects|topics)\/.+\.md$/i.test(rel)) continue
    const ent = getSaturationEntry(ledger, rel)
    if (!ent) continue
    saturatedLines.push(
      `- \`${rel}\` — last meaningful lap ${ent.lastEditLap} at ${ent.lastMeaningfulEditAt}; indexed mail at edit: ${ent.mailIndexedTotalAtEdit}`,
    )
  }

  const lines: string[] = ['## Server-computed vault gaps (trust this list)', '']

  if (broken.length > 0) {
    lines.push('### Broken or missing wikilink targets', '')
    for (const b of broken.slice(0, 40)) {
      lines.push(`- \`[[${b.target}]]\` — referenced from \`${b.sourcePath}\``)
    }
    lines.push('')
  }

  if (contacts.length > 0) {
    lines.push('### Frequent mail contacts without a `people/` page (heuristic)', '')
    for (const c of contacts) {
      lines.push(
        `- **${c.label}**${c.suggestedPath ? ` — suggested: \`${c.suggestedPath}\`` : ''}`,
      )
    }
    lines.push('')
  }

  if (saturatedLines.length > 0) {
    lines.push(
      `### Recently touched paths (saturation — skip unless mail index grew by ≥${WIKI_SATURATION_MIN_INDEXED_DELTA} or new evidence)`,
      '',
    )
    lines.push(...saturatedLines.slice(0, 35))
    lines.push('')
  }

  if (lines.length <= 2) {
    lines.push('*(No broken links or top-contact gaps detected; use mail tools for deeper gap analysis.)*', '')
  }

  return lines.join('\n')
}
