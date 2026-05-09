export type WikiRecentEditRow = { path: string; date: string }

export async function fetchWikiRecentEditsList(limit = 5): Promise<WikiRecentEditRow[]> {
  try {
    const histRes = await fetch(`/api/wiki/edit-history?limit=${limit}`)
    if (histRes.ok) {
      const j = (await histRes.json()) as { files?: WikiRecentEditRow[] }
      const files = Array.isArray(j.files) ? j.files : []
      if (files.length > 0) return files
    }
    const recentRes = await fetch(`/api/wiki/recent?limit=${limit}`)
    if (recentRes.ok) {
      const j = (await recentRes.json()) as { files?: WikiRecentEditRow[] }
      return Array.isArray(j.files) ? j.files : []
    }
  } catch {
    /* ignore */
  }
  return []
}
