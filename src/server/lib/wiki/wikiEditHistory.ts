import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { wikiEditsPathResolved } from '@server/lib/platform/brainHome.js'

export type WikiEditOp = 'edit' | 'write' | 'move' | 'delete'

export interface WikiEditRecord {
  ts: string
  op: WikiEditOp
  path: string
  /** Present for op=move (source path, normalized relative to wiki root). */
  fromPath?: string
  source: 'agent' | 'user'
}

/** `$BRAIN_HOME/var/wiki-edits.jsonl` (see `shared/brain-layout.json`, key `wikiEditsLog`).
 * Append-only JSONL: each successful wiki **`write`**, **`edit`**, **`move_file`**, and **`delete_file`** from agent tools adds a row via `appendWikiEditRecord`.
 * Prefer tailing or injecting excerpts for WikiBuilder / analytics — not LLM maintenance of markdown activity files.
 */
export function wikiEditHistoryPath(): string {
  return wikiEditsPathResolved()
}

export function normalizeWikiRelativePath(wikiDir: string, filePath: string): string {
  const abs = resolve(wikiDir, filePath)
  const rel = relative(wikiDir, abs)
  if (rel.startsWith('..') || rel === '') return filePath.split(/[/\\]/).join('/')
  return rel.split(/[/\\]/).join('/')
}

/**
 * Resolve a path under `wikiDir` and throw if it escapes the wiki root or refers to the root itself.
 * Returns an absolute filesystem path.
 */
export function resolveSafeWikiPath(wikiDir: string, filePath: string): string {
  const abs = resolve(wikiDir, filePath)
  const rel = relative(wikiDir, abs)
  if (rel.startsWith('..') || rel === '') {
    throw new Error('Path must be a file or directory inside the wiki directory (not the wiki root itself)')
  }
  return abs
}

/**
 * Coerce pi-coding-agent tool paths to a path relative to `wikiDir` so absolute OS paths cannot
 * bypass the wiki root ({@link resolveSafeWikiPath}).
 */
export function coerceWikiToolRelativePath(wikiDir: string, rawPath: string): string {
  const t = rawPath.trim()
  if (t === '' || t === '.' || t === './') return '.'
  const abs = resolveSafeWikiPath(wikiDir, t)
  return relative(wikiDir, abs)
}

export async function appendWikiEditRecord(
  wikiDir: string,
  op: WikiEditOp,
  filePath: string,
  options?: { fromPath?: string; source?: 'agent' | 'user' },
): Promise<void> {
  const path = normalizeWikiRelativePath(wikiDir, filePath)
  const record: WikiEditRecord = {
    ts: new Date().toISOString(),
    op,
    path,
    source: options?.source ?? 'agent',
    ...(options?.fromPath != null ? { fromPath: normalizeWikiRelativePath(wikiDir, options.fromPath) } : {}),
  }
  const file = wikiEditHistoryPath()
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
}

/**
 * Newest-first, unique paths (first win = most recent edit per file).
 * `date` is the full `ts` ISO string from the log (not calendar day only) so UIs can show accurate relative times.
 */
/** Remove agent wiki edit history (e.g. before re-seeding the vault). */
export async function truncateWikiEditHistoryFile(): Promise<void> {
  try {
    await unlink(wikiEditHistoryPath())
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code !== 'ENOENT') throw e
  }
}

export async function readRecentWikiEdits(limit: number): Promise<{ path: string; date: string }[]> {
  const file = wikiEditHistoryPath()
  let raw = ''
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter(Boolean)
  const records: WikiEditRecord[] = []
  for (const line of lines) {
    try {
      records.push(JSON.parse(line) as WikiEditRecord)
    } catch { /* skip corrupt line */ }
  }
  records.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
  const seen = new Set<string>()
  const out: { path: string; date: string }[] = []
  for (const r of records) {
    if (!r.path || seen.has(r.path)) continue
    seen.add(r.path)
    out.push({ path: r.path, date: r.ts })
    if (out.length >= limit) break
  }
  return out
}
