/** Row shape from `GET /api/wiki-shares` (matches server `WikiShareApi`). */
export type WikiShareApiRow = {
  id: string
  ownerId: string
  ownerHandle: string
  granteeEmail: string
  granteeId: string | null
  pathPrefix: string
  targetKind: 'dir' | 'file'
  createdAtMs: number
  acceptedAtMs: number | null
  revokedAtMs: number | null
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
