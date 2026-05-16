/**
 * Resolve draft recipient strings via indexed contacts when not already valid emails.
 */

import { looksLikeEmailAddress, extractEmailAddress } from '@shared/emailAddress.js'
import type { RipmailDb } from './db.js'
import type { PersonResult } from './types.js'
import { who } from './who.js'

export class DraftRecipientResolutionError extends Error {
  readonly input: string
  readonly candidates?: string[]

  constructor(message: string, input: string, candidates?: string[]) {
    super(message)
    this.name = 'DraftRecipientResolutionError'
    this.input = input
    this.candidates = candidates
  }
}

function normalizeQuery(s: string): string {
  return s.trim().toLowerCase()
}

/** Loose match for local parts (team_macrum ↔ team.macrum). */
function localPartLooseEqual(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[._-]/g, '')
  const nb = b.toLowerCase().replace(/[._-]/g, '')
  return na.length > 0 && na === nb
}

function whoLookupQueries(input: string): string[] {
  const base = input.trim()
  const out = new Set<string>([base])
  if (base.includes('_')) {
    out.add(base.replace(/_/g, '.'))
    out.add(base.replace(/_/g, ' '))
  }
  if (base.includes('.')) {
    out.add(base.replace(/\./g, '_'))
  }
  return [...out]
}

function lookupContacts(db: RipmailDb, input: string): PersonResult[] {
  const seen = new Set<string>()
  const merged: PersonResult[] = []
  for (const q of whoLookupQueries(input)) {
    const { contacts } = who(db, q, { limit: 8 })
    for (const c of contacts) {
      const key = extractEmailAddress(c.primaryAddress)
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push(c)
    }
  }
  return merged
}

function scoreContact(query: string, contact: PersonResult): number {
  const q = normalizeQuery(query)
  if (!q) return 0
  const addr = extractEmailAddress(contact.primaryAddress)
  const local = addr.includes('@') ? addr.split('@')[0]! : addr
  const name = (contact.displayName ?? '').trim().toLowerCase()
  if (addr === q) return 100
  if (local === q || localPartLooseEqual(local, q)) return 90
  if (addr.includes(q)) return 70
  if (name === q) return 65
  if (name.includes(q)) return 50
  return 10
}

function formatCandidate(c: PersonResult): string {
  const name = c.displayName?.trim()
  return name ? `${name} <${c.primaryAddress}>` : c.primaryAddress
}

const FIND_PERSON_HINT =
  'Use the find_person tool (or ripmail who) to look up the correct email address, then try again.'

/**
 * Resolve one recipient: accept valid emails; otherwise match indexed contacts.
 */
export function resolveDraftRecipient(db: RipmailDb, raw: string): string {
  const input = raw.trim()
  if (!input) {
    throw new DraftRecipientResolutionError('Recipient address is empty.', input)
  }
  if (looksLikeEmailAddress(input)) {
    return extractEmailAddress(input)
  }

  const viable = lookupContacts(db, input).filter((c) => looksLikeEmailAddress(c.primaryAddress))
  if (viable.length === 0) {
    throw new DraftRecipientResolutionError(
      `No email address found for "${input}". ${FIND_PERSON_HINT}`,
      input,
    )
  }

  const ranked = viable
    .map((c) => ({ c, score: scoreContact(input, c) }))
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]!
  const second = ranked[1]

  const clearSingle =
    viable.length === 1 ||
    (best.score >= 65 && (!second || best.score - second.score >= 25))

  if (!clearSingle) {
    const candidates = viable.slice(0, 5).map(formatCandidate)
    throw new DraftRecipientResolutionError(
      `Ambiguous recipient "${input}" — multiple contacts match (${candidates.join('; ')}). ${FIND_PERSON_HINT}`,
      input,
      candidates,
    )
  }

  return extractEmailAddress(best.c.primaryAddress)
}

export function resolveDraftRecipients(db: RipmailDb, rawAddresses: string[]): string[] {
  return rawAddresses.map((a) => resolveDraftRecipient(db, a))
}

/** Fail before send when any recipient on disk is not a valid email. */
export function assertDraftRecipientsValid(draft: {
  to?: string[]
  cc?: string[]
  bcc?: string[]
}): void {
  const bad: string[] = []
  for (const list of [draft.to, draft.cc, draft.bcc]) {
    if (!list) continue
    for (const addr of list) {
      if (!looksLikeEmailAddress(addr)) bad.push(addr)
    }
  }
  if (bad.length > 0) {
    throw new DraftRecipientResolutionError(
      `Invalid recipient address(es): ${bad.join(', ')}. ${FIND_PERSON_HINT}`,
      bad[0]!,
      bad,
    )
  }
}
