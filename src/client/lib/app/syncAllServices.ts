export type SyncResponseBody = { ok?: boolean; error?: string }

function appendServiceErrors(
  out: string[],
  label: string,
  settled: PromiseSettledResult<SyncResponseBody>,
): void {
  if (settled.status === 'rejected') {
    out.push(`${label}: ${settled.reason}`)
    return
  }
  const value = settled.value
  if (value && !value.ok) {
    out.push(`${label}: ${value.error ?? 'sync failed'}`)
  }
}

export function aggregateSyncErrors(
  wiki: PromiseSettledResult<SyncResponseBody>,
  inbox: PromiseSettledResult<SyncResponseBody>,
  calendar: PromiseSettledResult<SyncResponseBody>,
): string[] {
  const errs: string[] = []
  appendServiceErrors(errs, 'Docs', wiki)
  appendServiceErrors(errs, 'Inbox', inbox)
  appendServiceErrors(errs, 'Calendar', calendar)
  return errs
}

/** POST wiki, inbox, and calendar sync in parallel; returns API error messages (may be empty). */
export async function runParallelSyncs(fetchImpl: typeof fetch): Promise<string[]> {
  try {
    const [wikiRes, inboxRes, calRes] = await Promise.allSettled([
      fetchImpl('/api/wiki/sync', { method: 'POST' }).then(r => r.json() as Promise<SyncResponseBody>),
      fetchImpl('/api/inbox/sync', { method: 'POST' }).then(r => r.json() as Promise<SyncResponseBody>),
      fetchImpl('/api/calendar/sync', { method: 'POST' }).then(r => r.json() as Promise<SyncResponseBody>),
    ])
    return aggregateSyncErrors(wikiRes, inboxRes, calRes)
  } catch (e) {
    return [`Unexpected error: ${e}`]
  }
}
