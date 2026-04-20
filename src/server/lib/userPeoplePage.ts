import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Identity fields shared with ripmail whoami parsing (see profilingAgent). */
export type UserIdentityForPeoplePage = {
  displayName: string
  primaryEmail: string
}

const SKELETON_MARKER = '<!-- brain: user-page-skeleton -->'

/**
 * URL-safe slug for `people/<slug>.md` from display name, or email local part as fallback.
 */
export function slugFromUserIdentity(identity: UserIdentityForPeoplePage): string {
  const raw = identity.displayName.trim() || identity.primaryEmail.split('@')[0] || 'user'
  const slug = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'user'
}

export function userPeoplePageRelativePath(slug: string): string {
  return `people/${slug}.md`
}

function buildSkeletonMarkdown(identity: UserIdentityForPeoplePage): string {
  const title = identity.displayName.trim() || identity.primaryEmail
  return [
    '---',
    'type: person',
    'role: self',
    '---',
    '',
    SKELETON_MARKER,
    '',
    `# ${title}`,
    '',
    'Long-form biography, interests, and projects live here and grow over time. The short **session context** for the assistant is in [[me]] (root). Wiki buildout may expand this page from your mail.',
    '',
  ].join('\n')
}

/**
 * Ensures a skeletal `people/<slug>.md` exists for the account holder. Does not overwrite if the file already exists.
 */
export async function ensureUserPeoplePageSkeleton(
  wikiRoot: string,
  identity: UserIdentityForPeoplePage,
): Promise<{ relativePath: string; slug: string }> {
  const slug = slugFromUserIdentity(identity)
  const relativePath = userPeoplePageRelativePath(slug)
  const abs = join(wikiRoot, relativePath)
  if (existsSync(abs)) {
    return { relativePath, slug }
  }
  await mkdir(join(wikiRoot, 'people'), { recursive: true })
  await writeFile(abs, buildSkeletonMarkdown(identity), 'utf-8')
  return { relativePath, slug }
}
