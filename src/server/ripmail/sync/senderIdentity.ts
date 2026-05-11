/**
 * Choose a human-facing From identity for indexing when the raw From header
 * uses a routing/technical address but Reply-To / Sender / additional From
 * entries carry the same person's mailbox on the same domain.
 */

export type MailAddressEntry = { name?: string; address?: string }

type Source = 'from' | 'reply-to' | 'sender' | 'to-match'

type Candidate = {
  address: string
  name?: string
  source: Source
  index: number
}

/** Public for unit tests: local mailbox tokens implied by a display name. */
export function nameDerivedEmailLocals(displayName: string): Set<string> {
  const normalized = displayName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
  const words = normalized
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
  const out = new Set<string>()
  if (words.length === 0) return out

  const first = words[0]!
  const last = words[words.length - 1]!

  for (const w of words) {
    if (w.length >= 2) out.add(w)
  }
  out.add(first + last)
  out.add(first + '.' + last)
  out.add(last + '.' + first)
  out.add(first + '_' + last)
  out.add(first[0]! + last)
  for (let i = 1; i < words.length; i++) {
    out.add(first[0]! + words[i]!)
  }
  return out
}

function domainOf(addr: string): string {
  const i = addr.lastIndexOf('@')
  return i < 0 ? '' : addr.slice(i + 1).toLowerCase()
}

function localPart(addr: string): string {
  const i = addr.lastIndexOf('@')
  return i < 0 ? addr : addr.slice(0, i)
}

function scoreLocalPart(local: string, displayName: string | undefined): number {
  const lower = local.toLowerCase()
  let s = 0
  if (displayName) {
    const set = nameDerivedEmailLocals(displayName)
    if (set.has(lower)) s += 200
  }
  const digitCount = (lower.match(/\d/g) ?? []).length
  if (digitCount > 0) s -= 35
  const letters = (lower.match(/[a-z]/g) ?? []).length
  const len = lower.length || 1
  const letterRatio = letters / len
  if (letterRatio >= 0.9 && len >= 6) s += 20
  if (len >= 8 && digitCount === 0) s += 10
  if (lower.includes('.') && letterRatio > 0.85) s += 15
  return s
}

function entriesToCandidates(
  entries: MailAddressEntry[] | undefined,
  source: Source,
): Candidate[] {
  if (!entries?.length) return []
  const out: Candidate[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const a = e?.address?.trim()
    if (a) out.push({ address: a, name: e?.name, source, index: i })
  }
  return out
}

function tieBreak(c: Candidate): number {
  const sourceRank: Record<Source, number> = {
    from: 4,
    'reply-to': 3,
    'to-match': 2,
    sender: 1,
  }
  return sourceRank[c.source] * 1000 - c.index
}

/** Same-domain To address that matches display name — only when unambiguous. */
function unambiguousToIdentityCandidates(
  toAddresses: string[] | undefined,
  anchorDomain: string,
  displayName: string | undefined,
  baseScore: number,
): Candidate[] {
  if (!toAddresses?.length || !displayName || baseScore >= 200) return []
  const set = nameDerivedEmailLocals(displayName)
  const hits = toAddresses
    .map((a) => a.trim())
    .filter(
      (addr) => domainOf(addr) === anchorDomain && set.has(localPart(addr).toLowerCase()),
    )
  const unique = [...new Set(hits.map((h) => h.toLowerCase()))]
  if (unique.length !== 1) return []
  const addr = hits[0]!
  const s = scoreLocalPart(localPart(addr), displayName)
  if (s < 200) return []
  return [{ address: addr, source: 'to-match', index: 0 }]
}

/**
 * Pick indexed `from_address` / `from_name` from mailparser-style address blocks.
 * Prefers same-domain Reply-To/Sender only when they clearly beat the first From
 * address (display-name match or score margin).
 */
export function pickIndexedFromFields(
  fromBlock: { value: MailAddressEntry[] } | undefined,
  opts: {
    replyTo?: { value: MailAddressEntry[] } | undefined
    sender?: { value: MailAddressEntry[] } | undefined
    /** To: headers only (not Cc) — used when exactly one same-domain address matches the From display name. */
    toAddresses?: string[] | undefined
  } = {},
): { fromAddress: string; fromName?: string } {
  const fromValues = fromBlock?.value ?? []
  const firstAddr = fromValues[0]?.address?.trim()
  if (!firstAddr) {
    return { fromAddress: '', fromName: undefined }
  }

  const displayName = fromValues[0]?.name?.trim() || undefined
  const anchorDomain = domainOf(firstAddr)

  const fromCandidates = entriesToCandidates(fromValues, 'from')
  const baseScore = scoreLocalPart(localPart(firstAddr), displayName)

  const extraRaw = [
    ...entriesToCandidates(opts.replyTo?.value, 'reply-to').filter(
      (c) => domainOf(c.address) === anchorDomain,
    ),
    ...entriesToCandidates(opts.sender?.value, 'sender').filter(
      (c) => domainOf(c.address) === anchorDomain,
    ),
    ...unambiguousToIdentityCandidates(opts.toAddresses, anchorDomain, displayName, baseScore),
  ]

  const extra = extraRaw.filter((c) => {
    const s = scoreLocalPart(localPart(c.address), displayName)
    return s >= 200 || s > baseScore + 10
  })

  const considered: Candidate[] = [...fromCandidates, ...extra]
  let best = considered[0]!
  let bestScore = scoreLocalPart(localPart(best.address), displayName)
  let bestTie = tieBreak(best)

  for (let i = 1; i < considered.length; i++) {
    const c = considered[i]!
    const s = scoreLocalPart(localPart(c.address), displayName)
    const t = tieBreak(c)
    if (s > bestScore || (s === bestScore && t > bestTie)) {
      best = c
      bestScore = s
      bestTie = t
    }
  }

  return {
    fromAddress: best.address.trim(),
    fromName: displayName ?? (best.name?.trim() || undefined),
  }
}
