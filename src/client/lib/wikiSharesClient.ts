/** Row shape from `GET /api/wiki-shares` (matches server `WikiShareApi`). */
export type WikiShareApiRow = {
  id: string
  ownerId: string
  ownerHandle: string
  granteeEmail: string | null
  granteeId: string
  /** When the invitee has a confirmed workspace handle. */
  granteeHandle?: string
  pathPrefix: string
  targetKind: 'dir' | 'file'
  createdAtMs: number
  acceptedAtMs: number | null
  revokedAtMs: number | null
}

export type WikiShareGranteeDisplay = Pick<WikiShareApiRow, 'granteeHandle' | 'granteeEmail' | 'granteeId'>

export function wikiShareGranteeLabel(row: WikiShareGranteeDisplay): string {
  const h = row.granteeHandle?.trim()
  if (h) return `@${h}`
  if (row.granteeEmail) return row.granteeEmail
  return row.granteeId
}

export type WikiSharesListResponse = {
  owned: WikiShareApiRow[]
  received: WikiShareApiRow[]
  pendingReceived: WikiShareApiRow[]
}

export async function fetchWikiSharesList(): Promise<WikiSharesListResponse | null> {
  const res = await fetch('/api/wiki-shares')
  if (!res.ok) return null
  return (await res.json()) as WikiSharesListResponse
}
