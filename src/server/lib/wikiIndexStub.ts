import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Marker so tooling can tell this file was seeded by Brain (optional future use). */
export const WIKI_INDEX_STUB_MARKER = '<!-- brain: wiki-index-stub -->'

function buildIndexMarkdown(accountHolderPeopleWikilink?: string): string {
  const peopleLine = accountHolderPeopleWikilink
    ? `- [[${accountHolderPeopleWikilink}]] — long-form notes about you (separate from [[me]])`
    : null
  return [
    '---',
    'type: index',
    '---',
    '',
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
  const body = buildIndexMarkdown(options?.accountHolderPeopleWikilink)
  await writeFile(abs, body, 'utf-8')
  return { created: true }
}
