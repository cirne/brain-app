/**
 * Shape of GET /api/account/workspace-handles (see `routes/account.ts`).
 * Used by e2e directory polling helpers.
 */
export function workspaceDirectoryApiJsonIncludesHandle(payload: unknown, handle: string): boolean {
  if (!payload || typeof payload !== 'object') return false
  const results = (payload as { results?: unknown }).results
  if (!Array.isArray(results)) return false
  return results.some(
    (row) =>
      row !== null && typeof row === 'object' && (row as { handle?: unknown }).handle === handle,
  )
}
