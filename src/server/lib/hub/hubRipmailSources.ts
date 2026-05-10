import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import {
  ripmailSourcesList,
  ripmailSourcesRemove,
  ripmailSourcesStatus,
  ripmailCalendarListCalendars,
  loadRipmailConfig,
  saveRipmailConfig,
} from '@server/ripmail/index.js'
import type { SourceConfig } from '@server/ripmail/sync/config.js'

/** One row from in-process `sourcesList` (CLI parity: `ripmail sources list --json`). */
export type HubRipmailSourceRow = {
  id: string
  kind: string
  displayName: string
  path: string | null
}

export type HubRipmailSourcesPayload = {
  sources: HubRipmailSourceRow[]
  error?: string
}

/** Per-source index stats from in-process `sourcesStatus` (CLI parity: `ripmail sources status --json`). */
export type HubRipmailSourceStatusRow = {
  documentIndexRows: number
  calendarEventRows: number
  lastSyncedAt: string | null
}

export type HubFileSourceRoot = {
  id: string
  name: string
  recursive: boolean
}

/** Unified `fileSource` block (`localDir`, `googleDrive`, future file hosts). */
export type HubFileSourceConfig = {
  roots: HubFileSourceRoot[]
  includeGlobs: string[]
  ignoreGlobs: string[]
  maxFileBytes: number
  respectGitignore: boolean
}

export type HubRipmailSourceDetailOk = {
  ok: true
  id: string
  kind: string
  displayName: string
  path: string | null
  email: string | null
  label: string | null
  oauthSourceId: string | null
  fileSource: HubFileSourceConfig | null
  includeSharedWithMe: boolean
  calendarIds: string[] | null
  icsUrl: string | null
  status: HubRipmailSourceStatusRow | null
  statusError?: string
}

export type HubRipmailSourceDetailPayload =
  | HubRipmailSourceDetailOk
  | { ok: false; error: string }

function pickDisplayName(r: SourceConfig, id: string): string {
  if (r.label?.trim()) return r.label.trim()
  if (r.email?.trim()) return r.email.trim()
  return id
}

export async function removeHubRipmailSource(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = id?.trim()
  if (!trimmed) return { ok: false, error: 'Source id required' }
  try {
    ripmailSourcesRemove(ripmailHomeForBrain(), trimmed)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getHubRipmailSourcesList(): Promise<HubRipmailSourcesPayload> {
  try {
    const home = ripmailHomeForBrain()
    const { sources } = ripmailSourcesList(home)
    return {
      sources: sources.map((s) => ({
        id: s.id,
        kind: s.kind,
        displayName: s.label ?? s.id,
        path: null,
      })),
    }
  } catch (e) {
    return { sources: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getHubRipmailSourceDetail(id: string): Promise<HubRipmailSourceDetailPayload> {
  const trimmed = id?.trim()
  if (!trimmed) return { ok: false, error: 'id required' }
  const home = ripmailHomeForBrain()
  const config = loadRipmailConfig(home)
  const cfgRow = (config.sources ?? []).find((s) => s.id === trimmed)
  if (!cfgRow) return { ok: false, error: 'Source not found' }

  let status: HubRipmailSourceStatusRow | null = null
  let statusError: string | undefined
  try {
    const statusRows = ripmailSourcesStatus(home)
    const row = statusRows.find((r) => r.sourceId === trimmed)
    if (row) {
      status = {
        documentIndexRows: row.docCount,
        calendarEventRows: 0,
        lastSyncedAt: row.lastSyncedAt ?? null,
      }
    }
  } catch (e) {
    statusError = e instanceof Error ? e.message : String(e)
  }

  const kind = cfgRow.kind ?? ''
  const row = cfgRow as unknown as Record<string, unknown>
  const fileSourceRaw = row.fileSource as { roots?: Array<{ id: string; name?: string; recursive?: boolean }>; includeGlobs?: string[]; ignoreGlobs?: string[]; maxFileBytes?: number; respectGitignore?: boolean } | null | undefined
  let fileSource: HubFileSourceConfig | null = null
  if (fileSourceRaw) {
    fileSource = {
      roots: (fileSourceRaw.roots ?? []).map((r) => ({ id: r.id, name: r.name ?? r.id, recursive: r.recursive ?? true })),
      includeGlobs: fileSourceRaw.includeGlobs ?? [],
      ignoreGlobs: fileSourceRaw.ignoreGlobs ?? [],
      maxFileBytes: fileSourceRaw.maxFileBytes ?? 10_000_000,
      respectGitignore: fileSourceRaw.respectGitignore ?? true,
    }
  }

  const calendarIds = row.calendarIds as string[] | null | undefined
  const icsUrl = row.icsUrl as string | null | undefined
  const includeSharedWithMe = Boolean(row.includeSharedWithMe)
  const oauthSourceId = row.oauthSourceId as string | null | undefined

  return {
    ok: true,
    id: trimmed,
    kind,
    displayName: pickDisplayName(cfgRow, trimmed),
    path: null,
    email: cfgRow.email ?? null,
    label: cfgRow.label ?? null,
    oauthSourceId: typeof oauthSourceId === 'string' ? oauthSourceId : null,
    fileSource,
    includeSharedWithMe,
    calendarIds: Array.isArray(calendarIds) ? calendarIds : null,
    icsUrl: typeof icsUrl === 'string' ? icsUrl : null,
    status,
    ...(statusError ? { statusError } : {}),
  }
}

export type HubBrowseFolderRow = { id: string; name: string; hasChildren: boolean }

export async function browseHubRipmailFolders(
  _sourceId: string,
  parentId?: string,
): Promise<{ ok: true; folders: HubBrowseFolderRow[] } | { ok: false; error: string }> {
  const dir = parentId?.trim() || '/'
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    const folders: HubBrowseFolderRow[] = []
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const fullPath = join(dir, e.name)
      let hasChildren = false
      try {
        const sub = readdirSync(fullPath, { withFileTypes: true })
        hasChildren = sub.some((s) => s.isDirectory() && !s.name.startsWith('.'))
      } catch { /* ignore */ }
      folders.push({ id: fullPath, name: e.name, hasChildren })
    }
    return { ok: true, folders }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function updateHubRipmailFileSource(
  id: string,
  fileSource: HubFileSourceConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = id?.trim()
  if (!trimmed) return { ok: false, error: 'id required' }
  try {
    const home = ripmailHomeForBrain()
    const config = loadRipmailConfig(home)
    const sources = config.sources ?? []
    const idx = sources.findIndex((s) => s.id === trimmed)
    if (idx === -1) return { ok: false, error: 'Source not found' }
    ;(sources[idx] as unknown as Record<string, unknown>).fileSource = fileSource
    saveRipmailConfig(home, { ...config, sources })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function updateIncludeSharedWithMe(
  id: string,
  include: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = id?.trim()
  if (!trimmed) return { ok: false, error: 'id required' }
  try {
    const home = ripmailHomeForBrain()
    const config = loadRipmailConfig(home)
    const sources = config.sources ?? []
    const idx = sources.findIndex((s) => s.id === trimmed)
    if (idx === -1) return { ok: false, error: 'Source not found' }
    ;(sources[idx] as unknown as Record<string, unknown>).includeSharedWithMe = include
    saveRipmailConfig(home, { ...config, sources })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type HubCalendarRow = { id: string; name: string; color?: string }

export function resolveConfiguredCalendarIdsForPicker(
  configuredIds: string[],
  allCalendars: HubCalendarRow[],
  sourceEmail?: string | null,
): string[] {
  const listIds = new Set(allCalendars.map((c) => c.id))
  const email = sourceEmail?.trim() ?? ''
  return configuredIds.map((raw) => {
    const id = raw.trim()
    if (id !== 'primary') return id
    if (listIds.has('primary')) return 'primary'
    if (email.includes('@')) {
      const hit = allCalendars.find((c) => c.id === email || c.id.toLowerCase() === email.toLowerCase())
      if (hit) return hit.id
    }
    if (allCalendars.length === 1) return allCalendars[0].id
    return id
  })
}

export async function getHubRipmailCalendarsForSource(sourceId: string): Promise<
  | { ok: true; allCalendars: HubCalendarRow[]; configuredIds: string[] }
  | { ok: false; error: string }
> {
  const trimmed = sourceId?.trim()
  if (!trimmed) return { ok: false, error: 'id required' }
  try {
    const home = ripmailHomeForBrain()
    const calendars = ripmailCalendarListCalendars(home, { sourceIds: [trimmed] })
    const allCalendars: HubCalendarRow[] = calendars.map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
    }))
    // Load configured calendar IDs from config.json
    const config = loadRipmailConfig(home)
    const cfgRow = (config.sources ?? []).find((s) => s.id === trimmed)
    const configuredIdsRaw = (cfgRow as unknown as Record<string, unknown> | undefined)?.calendarIds as
      | string[]
      | undefined
    const configuredIds = Array.isArray(configuredIdsRaw)
      ? resolveConfiguredCalendarIdsForPicker(configuredIdsRaw, allCalendars, cfgRow?.email)
      : []
    return { ok: true, allCalendars, configuredIds }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function updateHubRipmailCalendarIds(
  sourceId: string,
  calendarIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = sourceId?.trim()
  if (!trimmed) return { ok: false, error: 'id required' }
  if (!calendarIds.length) return { ok: false, error: 'at least one calendar ID required' }
  try {
    const home = ripmailHomeForBrain()
    const config = loadRipmailConfig(home)
    const sources = config.sources ?? []
    const idx = sources.findIndex((s) => s.id === trimmed)
    if (idx === -1) return { ok: false, error: 'Source not found' }
    ;(sources[idx] as unknown as Record<string, unknown>).calendarIds = calendarIds
    saveRipmailConfig(home, { ...config, sources })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
