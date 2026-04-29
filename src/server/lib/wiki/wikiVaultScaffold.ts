import {
  fetchRipmailWhoamiForProfiling,
  parseWhoamiProfileSubject,
  type UserPeoplePageRef,
} from '@server/agent/profilingAgent.js'
import { ensureUserPeoplePageSkeleton } from '@server/lib/wiki/userPeoplePage.js'
import {
  ensureWikiIndexAccountHolderPeopleLine,
  ensureWikiIndexMdStub,
} from '@server/lib/wiki/wikiIndexStub.js'
import { ensureStarterWikiSeed } from '@server/lib/wiki/starterWikiSeed.js'

/**
 * Seeds starter wiki files (non-destructive), account-holder `people/…` skeleton when whoami
 * resolves, and vault-root `index.md` / account-holder line on `index.md`.
 * Starter includes exemplar **`me.md`**; the interview may edit it anytime; finalize polishes after finish (OPP-054).
 */
export async function ensureWikiVaultScaffold(wikiRoot: string): Promise<UserPeoplePageRef | null> {
  await ensureStarterWikiSeed(wikiRoot)
  let userPeoplePage: UserPeoplePageRef | null = null
  const whoami = await fetchRipmailWhoamiForProfiling()
  const subject = parseWhoamiProfileSubject(whoami)
  if (subject) {
    try {
      userPeoplePage = await ensureUserPeoplePageSkeleton(wikiRoot, subject)
    } catch (e) {
      console.error('[wiki] ensureUserPeoplePageSkeleton failed (continuing to index.md stub):', e)
    }
  }
  const peopleWikilink =
    userPeoplePage?.relativePath.replace(/\.md$/i, '') ?? undefined
  await ensureWikiIndexMdStub(wikiRoot, { accountHolderPeopleWikilink: peopleWikilink })
  await ensureWikiIndexAccountHolderPeopleLine(wikiRoot, peopleWikilink)
  return userPeoplePage
}

/** Same as {@link ensureWikiVaultScaffold}; used by wiki buildout / expansion entrypoints. */
export async function ensureWikiVaultScaffoldForBuildout(
  wikiRoot: string,
): Promise<UserPeoplePageRef | null> {
  return ensureWikiVaultScaffold(wikiRoot)
}
