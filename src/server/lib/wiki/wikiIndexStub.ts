import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Marker so tooling can tell this file was seeded by Brain (optional future use). */
export const WIKI_INDEX_STUB_MARKER = '<!-- brain: wiki-index-stub -->'

/** One list item for the account holder’s long-form `people/…` page (matches starter `index.md` copy). */
export function formatAccountHolderPeopleIndexLine(accountHolderPeopleWikilink: string): string {
  return `- [[${accountHolderPeopleWikilink}]] — long-form notes about you (separate from [[me]])`
}

function buildIndexMarkdown(accountHolderPeopleWikilink?: string): string {
  const peopleLine = accountHolderPeopleWikilink
    ? formatAccountHolderPeopleIndexLine(accountHolderPeopleWikilink)
    : null
  return [
    WIKI_INDEX_STUB_MARKER,
    '',
    '# Home',
    '',
    'Your wiki hub — use the links below to browse.',
    '',
    '- [[me]] — short profile and assistant context',
    ...(peopleLine ? [peopleLine] : []),
    '',
    '## Directories',
    '',
    'As you add pages, keep this section useful: for each **top-level folder** you care about (`people`, `projects`, `topics`, `companies`, `ideas`, `areas`, …), add a bullet with a **[[wikilink]]** to a landing page (e.g. one representative note, or a concise sub-index you create). Replace or extend the starter lines below.',
    '',
    '- **People** — pages under `people/`',
    '- **Projects** — pages under `projects/`',
    '- **Topics** — pages under `topics/`',
    '',
  ].join('\n')
}

/**
 * Ensures vault-root `index.md` exists with [[me]] and directory scaffolding.
 * Does not overwrite an existing `index.md`.
 */
export async function ensureWikiIndexMdStub(
  wikiRoot: string,
  options?: { accountHolderPeopleWikilink?: string },
): Promise<{ created: boolean }> {
  const abs = join(wikiRoot, 'index.md')
  if (existsSync(abs)) {
    return { created: false }
  }
  await mkdir(wikiRoot, { recursive: true })
  const body = buildIndexMarkdown(options?.accountHolderPeopleWikilink)
  await writeFile(abs, body, 'utf-8')
  return { created: true }
}

/**
 * When `index.md` already exists (e.g. from starter wiki) but the account-holder people page was
 * created afterwards, insert the standard **people/…** bullet after the `[[me]]` line.
 */
export async function ensureWikiIndexAccountHolderPeopleLine(
  wikiRoot: string,
  accountHolderPeopleWikilink: string | undefined,
): Promise<{ updated: boolean }> {
  if (!accountHolderPeopleWikilink?.trim()) {
    return { updated: false }
  }
  const abs = join(wikiRoot, 'index.md')
  if (!existsSync(abs)) {
    return { updated: false }
  }
  const wikilink = `[[${accountHolderPeopleWikilink}]]`
  let body = await readFile(abs, 'utf-8')
  if (body.includes(wikilink)) {
    return { updated: false }
  }
  const insertLine = formatAccountHolderPeopleIndexLine(accountHolderPeopleWikilink)
  const meBullet = /^-\s+.*\[\[me\]\].*$/m
  if (meBullet.test(body)) {
    body = body.replace(meBullet, m => `${m}\n${insertLine}`)
  } else {
    body = `${body.trimEnd()}\n\n${insertLine}\n`
  }
  await writeFile(abs, body, 'utf-8')
  return { updated: true }
}
