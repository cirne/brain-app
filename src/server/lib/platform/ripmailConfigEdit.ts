/**
 * Targeted edits to ripmail `config.json` (sibling of {@link upsertRipmailConfig} in
 * `googleOAuth.ts`, which writes the IMAP source itself). Kept narrow on purpose so the desktop /
 * native crate continues to own the larger source-management surface; these helpers only touch
 * fields the Brain Hub UI needs to flip.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  RipmailConfigJson,
  RipmailSourceEntry,
} from '@server/lib/platform/googleOAuth.js'

const CONFIG_FILENAME = 'config.json'

async function readConfig(ripmailHome: string): Promise<RipmailConfigJson> {
  try {
    const raw = await readFile(join(ripmailHome, CONFIG_FILENAME), 'utf8')
    const j = JSON.parse(raw) as RipmailConfigJson
    return j ?? {}
  } catch {
    return {}
  }
}

async function writeConfig(ripmailHome: string, cfg: RipmailConfigJson): Promise<void> {
  await mkdir(ripmailHome, { recursive: true })
  const path = join(ripmailHome, CONFIG_FILENAME)
  await writeFile(path, `${JSON.stringify(cfg, null, 2)}\n`, 'utf-8')
}

/** True only when the source explicitly opted out via `search.includeInDefault === false`. */
export function sourceIncludedInDefaultSearch(s: RipmailSourceEntry | undefined | null): boolean {
  if (!s) return false
  return s.search?.includeInDefault !== false
}

/** Iterate ripmail sources, returning IMAP entries with their default-search flag resolved. */
export async function listImapSourcesWithVisibility(
  ripmailHome: string,
): Promise<Array<{ id: string; email: string; includeInDefault: boolean }>> {
  const cfg = await readConfig(ripmailHome)
  const out: Array<{ id: string; email: string; includeInDefault: boolean }> = []
  for (const s of cfg.sources ?? []) {
    if (!s || s.kind !== 'imap') continue
    out.push({
      id: s.id,
      email: s.email,
      includeInDefault: sourceIncludedInDefaultSearch(s),
    })
  }
  return out
}

/** True when the source id exists with `kind: 'imap'`. */
export async function imapSourceExists(ripmailHome: string, sourceId: string): Promise<boolean> {
  const id = sourceId.trim()
  if (!id) return false
  const cfg = await readConfig(ripmailHome)
  for (const s of cfg.sources ?? []) {
    if (s && s.kind === 'imap' && s.id === id) return true
  }
  return false
}

export type SetIncludeInDefaultResult =
  | { ok: true; id: string; includeInDefault: boolean }
  | { ok: false; error: 'not_found' | 'invalid_kind' }

/**
 * Toggle the search-default flag on a single source. Only IMAP sources are affected; trying to
 * toggle a non-mail source (e.g. `googleCalendar`) returns `invalid_kind` so the UI can surface a
 * clear explanation. `includeInDefault: true` removes the explicit flag entirely (its absence is
 * treated as "included" everywhere downstream).
 */
export async function setSourceIncludeInDefault(
  ripmailHome: string,
  sourceId: string,
  includeInDefault: boolean,
): Promise<SetIncludeInDefaultResult> {
  const id = sourceId.trim()
  if (!id) return { ok: false, error: 'not_found' }
  const cfg = await readConfig(ripmailHome)
  const sources = [...(cfg.sources ?? [])]
  const idx = sources.findIndex((s) => s && s.id === id)
  if (idx < 0) return { ok: false, error: 'not_found' }
  const target = sources[idx]
  if (!target || target.kind !== 'imap') {
    return { ok: false, error: 'invalid_kind' }
  }
  const next: RipmailSourceEntry = { ...target }
  if (includeInDefault) {
    if (next.search) {
      const { includeInDefault: _drop, ...rest } = next.search
      next.search = Object.keys(rest).length > 0 ? rest : undefined
    }
  } else {
    next.search = { ...(next.search ?? {}), includeInDefault: false }
  }
  sources[idx] = next
  cfg.sources = sources
  await writeConfig(ripmailHome, cfg)
  return { ok: true, id, includeInDefault }
}

export type SetDefaultSendSourceResult =
  | { ok: true; defaultSendSource: string | null }
  | { ok: false; error: 'not_found' | 'invalid_kind' }

/**
 * Pick which IMAP source is used when a draft / send command does not name a source. Pass `null`
 * to clear the preference. The id must reference an existing IMAP source so we never silently
 * point the agent at a calendar entry.
 */
export async function setDefaultSendSource(
  ripmailHome: string,
  sourceId: string | null,
): Promise<SetDefaultSendSourceResult> {
  const cfg = await readConfig(ripmailHome)
  if (sourceId == null || sourceId.trim() === '') {
    if (cfg.defaultSendSource == null) return { ok: true, defaultSendSource: null }
    delete cfg.defaultSendSource
    await writeConfig(ripmailHome, cfg)
    return { ok: true, defaultSendSource: null }
  }
  const id = sourceId.trim()
  let target: RipmailSourceEntry | null = null
  for (const s of cfg.sources ?? []) {
    if (!s || s.id !== id) continue
    if (s.kind !== 'imap') return { ok: false, error: 'invalid_kind' }
    target = s
    break
  }
  if (!target) return { ok: false, error: 'not_found' }
  cfg.defaultSendSource = id
  await writeConfig(ripmailHome, cfg)
  return { ok: true, defaultSendSource: id }
}

/** Read the current default send source; returns the id string or null. */
export async function readDefaultSendSource(ripmailHome: string): Promise<string | null> {
  const cfg = await readConfig(ripmailHome)
  const v = cfg.defaultSendSource
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * If only one IMAP source is configured and {@link readDefaultSendSource} is unset, mark it as the
 * default so the agent's send tool has an unambiguous answer. No-op otherwise. Idempotent.
 *
 * Returns the id that was promoted (if any). Used by the link callback (Phase 4 polish) and by
 * any callers that want a deterministic post-onboarding state.
 */
export async function ensureSingleSourceMarkedAsDefaultSend(
  ripmailHome: string,
): Promise<string | null> {
  const cfg = await readConfig(ripmailHome)
  if (typeof cfg.defaultSendSource === 'string' && cfg.defaultSendSource.trim()) return null
  const imap = (cfg.sources ?? []).filter(
    (s): s is RipmailSourceEntry => !!s && s.kind === 'imap',
  )
  if (imap.length !== 1) return null
  const only = imap[0]
  cfg.defaultSendSource = only.id
  await writeConfig(ripmailHome, cfg)
  return only.id
}
