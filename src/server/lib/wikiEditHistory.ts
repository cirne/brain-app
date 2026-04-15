import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

export type WikiEditOp = 'edit' | 'write' | 'move' | 'delete'

export interface WikiEditRecord {
  ts: string
  op: WikiEditOp
  path: string
  /** Present for op=move (source path, normalized relative to wiki root). */
  fromPath?: string
  source: 'agent'
}

/** Default: ./data/wiki-edits.jsonl under cwd. Override with WIKI_EDIT_HISTORY_PATH if needed. */
export function wikiEditHistoryPath(): string {
  return process.env.WIKI_EDIT_HISTORY_PATH ?? join(process.cwd(), 'data', 'wiki-edits.jsonl')
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

export async function appendWikiEditRecord(
  wikiDir: string,
  op: WikiEditOp,
  filePath: string,
  options?: { fromPath?: string },
): Promise<void> {
  const path = normalizeWikiRelativePath(wikiDir, filePath)
  const record: WikiEditRecord = {
    ts: new Date().toISOString(),
    op,
    path,
    source: 'agent',
    ...(options?.fromPath != null ? { fromPath: normalizeWikiRelativePath(wikiDir, options.fromPath) } : {}),
  }
  const file = wikiEditHistoryPath()
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
}

/** Newest-first, unique paths (first win = most recent edit per file). */
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
    out.push({ path: r.path, date: r.ts.slice(0, 10) })
    if (out.length >= limit) break
  }
  return out
}
