import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { execRipmailAsync, runRipmailArgv } from '@server/lib/ripmail/ripmailRun.js'

/** One row from `ripmail sources list --json`, normalized for Brain Hub. */
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

/** One source from `ripmail sources status --json` (per config row + SQLite aggregates). */
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
  /** Present for `localDir` / `googleDrive`. */
  fileSource: HubFileSourceConfig | null
  /** Top-level config flag; meaningful for `googleDrive`. */
  includeSharedWithMe: boolean
  calendarIds: string[] | null
  icsUrl: string | null
  status: HubRipmailSourceStatusRow | null
  /** Present when `sources status --json` failed but list succeeded. */
  statusError?: string
}

export type HubRipmailSourceDetailPayload =
  | HubRipmailSourceDetailOk
  | { ok: false; error: string }

function pickDisplayName(r: Record<string, unknown>, id: string): string {
  const label = typeof r.label === 'string' ? r.label.trim() : ''
  if (label) return label
  const email = typeof r.email === 'string' ? r.email.trim() : ''
  if (email) return email
  return id
}

export async function removeHubRipmailSource(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = id?.trim()
  if (!trimmed) return { ok: false, error: 'Source id required' }
  const rm = ripmailBin()
  try {
    await execRipmailAsync(`${rm} sources remove ${JSON.stringify(trimmed)} --json`, {
      timeout: 60_000,
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

export async function getHubRipmailSourcesList(): Promise<HubRipmailSourcesPayload> {
  const rm = ripmailBin()
  try {
    const { stdout } = await execRipmailAsync(`${rm} sources list --json`, { timeout: 15000 })
    const j = JSON.parse(stdout) as { sources?: unknown[] }
    const raw = Array.isArray(j.sources) ? j.sources : []
    const sources: HubRipmailSourceRow[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id : ''
      const kind = typeof r.kind === 'string' ? r.kind : ''
      if (!id || !kind) continue
      const path = typeof r.path === 'string' ? r.path : null
      sources.push({
        id,
        kind,
        displayName: pickDisplayName(r, id),
        path,
      })
    }
    return { sources }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { sources: [], error: msg }
  }
}

function parseFileSource(raw: unknown): HubFileSourceConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rootsRaw: unknown[] = Array.isArray(r.roots) ? r.roots : []
  const roots: HubFileSourceRoot[] = []
  for (const item of rootsRaw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    if (!id.trim()) continue
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : id
    const recursive = typeof o.recursive === 'boolean' ? o.recursive : true
    roots.push({ id, name, recursive })
  }
  const includeGlobs = Array.isArray(r.includeGlobs)
    ? (r.includeGlobs as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const ignoreGlobs = Array.isArray(r.ignoreGlobs)
    ? (r.ignoreGlobs as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const maxFileBytes =
    typeof r.maxFileBytes === 'number' && Number.isFinite(r.maxFileBytes)
      ? r.maxFileBytes
      : 10_000_000
  const respectGitignore =
    typeof r.respectGitignore === 'boolean' ? r.respectGitignore : true
  return {
    roots,
    includeGlobs,
    ignoreGlobs,
    maxFileBytes,
    respectGitignore,
  }
}

function findStatusRowForId(rows: unknown[], id: string): HubRipmailSourceStatusRow | null {
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (r.id !== id) continue
    const documentIndexRows =
      typeof r.documentIndexRows === 'number' && Number.isFinite(r.documentIndexRows)
        ? Math.trunc(r.documentIndexRows)
        : 0
    const calendarEventRows =
      typeof r.calendarEventRows === 'number' && Number.isFinite(r.calendarEventRows)
        ? Math.trunc(r.calendarEventRows)
        : 0
    const last =
      r.lastSyncedAt === null
        ? null
        : typeof r.lastSyncedAt === 'string'
          ? r.lastSyncedAt
          : null
    return { documentIndexRows, calendarEventRows, lastSyncedAt: last }
  }
  return null
}

/** Merge one configured source (`sources list --json`) with index stats (`sources status --json`). */
export async function getHubRipmailSourceDetail(id: string): Promise<HubRipmailSourceDetailPayload> {
  const trimmed = id?.trim()
  if (!trimmed) return { ok: false, error: 'id required' }
  const rm = ripmailBin()
  let listRaw: { sources?: unknown[] }
  try {
    const { stdout } = await execRipmailAsync(`${rm} sources list --json`, { timeout: 15_000 })
    listRaw = JSON.parse(stdout) as { sources?: unknown[] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  const arr = Array.isArray(listRaw.sources) ? listRaw.sources : []
  const cfgRow = arr.find((item) => {
    if (!item || typeof item !== 'object') return false
    return (item as Record<string, unknown>).id === trimmed
  }) as Record<string, unknown> | undefined

  if (!cfgRow) {
    return { ok: false, error: 'Source not found' }
  }

  let status: HubRipmailSourceStatusRow | null = null
  let statusError: string | undefined
  try {
    const { stdout } = await execRipmailAsync(`${rm} sources status --json`, { timeout: 15_000 })
    const j = JSON.parse(stdout) as { sources?: unknown[] }
    const rows = Array.isArray(j.sources) ? j.sources : []
    status = findStatusRowForId(rows, trimmed)
  } catch (e) {
    statusError = e instanceof Error ? e.message : String(e)
  }

  const kind = typeof cfgRow.kind === 'string' ? cfgRow.kind : ''
  const path = typeof cfgRow.path === 'string' ? cfgRow.path : null
  const email =
    typeof cfgRow.email === 'string' && cfgRow.email.trim() ? cfgRow.email.trim() : null
  const label =
    typeof cfgRow.label === 'string' && cfgRow.label.trim() ? cfgRow.label.trim() : null
  const oauthSourceId =
    typeof cfgRow.oauthSourceId === 'string' && cfgRow.oauthSourceId.trim()
      ? cfgRow.oauthSourceId.trim()
      : null

  let calendarIds: string[] | null = null
  if (Array.isArray(cfgRow.calendarIds)) {
    const ids = (cfgRow.calendarIds as unknown[]).filter((x): x is string => typeof x === 'string')
    calendarIds = ids.length ? ids : []
  }

  const icsUrl =
    typeof cfgRow.icsUrl === 'string' && cfgRow.icsUrl.trim() ? cfgRow.icsUrl.trim() : null

  const includeSharedWithMe =
    typeof cfgRow.includeSharedWithMe === 'boolean' ? cfgRow.includeSharedWithMe : false

  let fileSource =
    cfgRow.fileSource !== undefined && cfgRow.fileSource !== null
      ? parseFileSource(cfgRow.fileSource)
      : null

  if (
    kind === 'localDir' &&
    (!fileSource || fileSource.roots.length === 0) &&
    typeof cfgRow.path === 'string' &&
    cfgRow.path.trim()
  ) {
    const p = cfgRow.path.trim()
    const name = p.split(/[/\\]/).filter(Boolean).pop() ?? 'folder'
    fileSource = {
      roots: [{ id: p, name, recursive: true }],
      includeGlobs: [],
      ignoreGlobs: [],
      maxFileBytes: 10_000_000,
      respectGitignore: true,
    }
  }

  return {
    ok: true,
    id: trimmed,
    kind,
    displayName: pickDisplayName(cfgRow, trimmed),
    path,
    email,
    label,
    oauthSourceId,
    fileSource,
    includeSharedWithMe,
    calendarIds,
    icsUrl,
    status,
    ...(statusError ? { statusError } : {}),
  }
}

export type HubBrowseFolderRow = { id: string; name: string; hasChildren: boolean }

export async function browseHubRipmailFolders(
  sourceId: string,
  parentId?: string,
): Promise<{ ok: true; folders: HubBrowseFolderRow[] } | { ok: false; error: string }> {
  const id = sourceId?.trim()
  if (!id) return { ok: false, error: 'id required' }
  const argv = ['sources', 'browse-folders', '--id', id, '--json']
  const p = parentId?.trim()
  if (p) argv.push('--parent-id', p)
  try {
    const r = await runRipmailArgv(argv, {
      timeoutMs: 120_000,
      label: 'sources-browse-folders',
    })
    const j = JSON.parse(r.stdout) as { folders?: unknown[] }
    const raw = Array.isArray(j.folders) ? j.folders : []
    const folders: HubBrowseFolderRow[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const fid = typeof o.id === 'string' ? o.id : ''
      const name = typeof o.name === 'string' ? o.name : ''
      if (!fid) continue
      const hasChildren = typeof o.hasChildren === 'boolean' ? o.hasChildren : false
      folders.push({ id: fid, name: name || fid, hasChildren })
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
  const json = JSON.stringify(fileSource)
  try {
    await runRipmailArgv(
      ['sources', 'edit', trimmed, '--file-source-json', json, '--json'],
      { timeoutMs: 30_000, label: 'sources-edit-file-source' },
    )
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
    await runRipmailArgv(
      [
        'sources',
        'edit',
        trimmed,
        '--include-shared-with-me',
        include ? 'true' : 'false',
        '--json',
      ],
      { timeoutMs: 30_000, label: 'sources-edit-include-shared-with-me' },
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export type HubCalendarRow = { id: string; name: string; color?: string }

/**
 * Ripmail may store `calendar_ids: ["primary"]` while `list-calendars` enumerates API ids
 * (Google: primary calendar id is usually the account email, not the literal `primary`).
 * Map configured ids so Hub UI checkboxes match `allCalendars` rows.
 */
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
      const hit = allCalendars.find(
        (c) => c.id === email || c.id.toLowerCase() === email.toLowerCase(),
      )
      if (hit) return hit.id
    }
    if (allCalendars.length === 1) return allCalendars[0].id
    return id
  })
}

/**
 * Returns all available calendars (from `allCalendars`) and currently configured calendar IDs
 * for a `googleCalendar` source, by calling `ripmail calendar list-calendars --source <id> --json`.
 */
export async function getHubRipmailCalendarsForSource(sourceId: string): Promise<
  | { ok: true; allCalendars: HubCalendarRow[]; configuredIds: string[] }
  | { ok: false; error: string }
> {
  const trimmed = sourceId?.trim()
  if (!trimmed) return { ok: false, error: 'id required' }
  const rm = ripmailBin()
  try {
    const { stdout } = await execRipmailAsync(
      `${rm} calendar list-calendars --source ${JSON.stringify(trimmed)} --json`,
      { timeout: 15_000 },
    )
    const parsed = JSON.parse(stdout) as {
      calendars?: Array<{
        sourceId?: string
        email?: string
        calendars?: Array<{ id: string; name?: string; color?: string }>
        allCalendars?: Array<{ id: string; name?: string; color?: string }>
      }>
    }
    const sourceRows = Array.isArray(parsed.calendars) ? parsed.calendars : []
    const row = sourceRows.find((r) => r.sourceId === trimmed) ?? sourceRows[0]
    if (!row) return { ok: true, allCalendars: [], configuredIds: [] }

    const rawAll = Array.isArray(row.allCalendars) ? row.allCalendars : []
    const rawConfigured = Array.isArray(row.calendars) ? row.calendars : []
    const source = rawAll.length > 0 ? rawAll : rawConfigured

    const sourceEmail = typeof row.email === 'string' ? row.email : null

    const allCalendars: HubCalendarRow[] = source
      .filter((c) => c.id?.trim())
      .map((c) => ({
        id: c.id.trim(),
        name: c.name?.trim() || c.id.trim(),
        ...(typeof c.color === 'string' && c.color.trim()
          ? { color: c.color.trim() }
          : {}),
      }))

    const rawConfiguredIds = rawConfigured
      .filter((c) => c.id?.trim())
      .map((c) => c.id.trim())

    const configuredIds = resolveConfiguredCalendarIdsForPicker(rawConfiguredIds, allCalendars, sourceEmail)

    return { ok: true, allCalendars, configuredIds }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Update which Google Calendar IDs are synced for a source via `ripmail sources edit`. */
export async function updateHubRipmailCalendarIds(
  sourceId: string,
  calendarIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = sourceId?.trim()
  if (!trimmed) return { ok: false, error: 'id required' }
  if (!calendarIds.length) return { ok: false, error: 'at least one calendar ID required' }
  const calFlags = calendarIds.flatMap((id) => ['--calendar', id])
  /** Match agent `configure_source`: default day-view scope uses `defaultCalendars` when set. */
  const defFlags = calendarIds.flatMap((id) => ['--default-calendar', id])
  try {
    await runRipmailArgv(['sources', 'edit', trimmed, ...calFlags, ...defFlags, '--json'], {
      timeoutMs: 30_000,
      label: 'sources-edit-calendar-ids',
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
