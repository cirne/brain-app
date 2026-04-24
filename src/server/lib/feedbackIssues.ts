import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { brainLayoutIssuesDir, brainLayoutIssuesCounterPath } from './brainLayout.js'

const ISSUE_FILE_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)-issue-(\d+)\.md$/

export interface IssueListItem {
  id: number
  title: string
  createdAt: string
  filename: string
  type?: string
}

interface CounterFile {
  next: number
}

function parseFilename(name: string): { createdAt: string; id: number } | null {
  const m = name.match(ISSUE_FILE_RE)
  if (!m) return null
  return { createdAt: m[1], id: Number(m[2]) }
}

async function readCounter(home: string): Promise<number> {
  const p = brainLayoutIssuesCounterPath(home)
  if (!existsSync(p)) return 1
  try {
    const raw = await readFile(p, 'utf-8')
    const j = JSON.parse(raw) as CounterFile
    return typeof j.next === 'number' && j.next >= 1 ? j.next : 1
  } catch {
    return 1
  }
}

async function writeCounter(home: string, next: number): Promise<void> {
  const p = brainLayoutIssuesCounterPath(home)
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, `${JSON.stringify({ next }, null, 0)}\n`, 'utf-8')
}

/** Allocate next issue id and bump counter (atomic enough for single Node process). */
export async function allocateIssueId(home: string): Promise<number> {
  const v = await readCounter(home)
  await writeCounter(home, v + 1)
  return v
}

async function ensureIssuesDir(home: string): Promise<string> {
  const d = brainLayoutIssuesDir(home)
  await mkdir(d, { recursive: true })
  return d
}

/**
 * Write a feedback issue file. `bodyMarkdown` is the full markdown **body** after frontmatter;
 * or pass full file as `fullMarkdown` with frontmatter — id/title will be merged.
 */
export async function writeFeedbackIssue(
  home: string,
  params: {
    type: 'bug' | 'feature'
    title: string
    summary: string
    repro?: string
    redactionNote?: string
    extraFrontmatter?: Record<string, unknown>
  },
): Promise<{ id: number; path: string; filename: string }> {
  const id = await allocateIssueId(home)
  const createdAt = new Date().toISOString()
  const safeTitle = params.title.trim() || 'Untitled feedback'
  const dir = await ensureIssuesDir(home)
  const filename = `${createdAt}-issue-${id}.md`
  const path = join(dir, filename)

  const repro = params.repro?.trim() ?? ''
  const red = params.redactionNote?.trim()
  let body = `## Summary\n\n${params.summary.trim() || '_No summary._'}\n\n`
  if (repro) {
    body += `## Repro\n\n${repro}\n\n`
  }
  if (red) {
    body += `## Redaction\n\n${red}\n\n`
  }
  body += `> PII redaction in this report is best-effort; do not include secrets in follow-ups.\n`

  const fm = {
    issueId: id,
    type: params.type,
    title: safeTitle,
    createdAt,
    ...(params.extraFrontmatter ?? {}),
  }
  const text = matter.stringify(body, fm)
  await writeFile(path, text, 'utf-8')
  return { id, path, filename }
}

/** Persist a full markdown file (e.g. user-confirmed LLM output). Overwrites/sets issueId and createdAt in frontmatter, allocates new file name. */
export async function writeFeedbackIssueFromMarkdown(
  home: string,
  fullMarkdown: string,
): Promise<{ id: number; path: string; filename: string }> {
  const parsed = matter(fullMarkdown)
  const id = await allocateIssueId(home)
  const createdAt = new Date().toISOString()
  const dir = await ensureIssuesDir(home)
  const filename = `${createdAt}-issue-${id}.md`
  const path = join(dir, filename)

  const data: Record<string, unknown> = {
    ...(typeof parsed.data === 'object' && parsed.data != null
      ? (parsed.data as Record<string, unknown>)
      : {}),
    issueId: id,
    createdAt: String(createdAt),
  }
  if (typeof data.type !== 'string' || (data.type !== 'bug' && data.type !== 'feature')) {
    data.type = 'bug'
  }
  if (typeof data.title !== 'string' || !String(data.title).trim()) {
    data.title = 'Feedback'
  }

  const out = matter.stringify(parsed.content, data)
  await mkdir(dir, { recursive: true })
  await writeFile(path, out, 'utf-8')
  return { id, path, filename }
}

export async function listFeedbackIssues(home: string): Promise<IssueListItem[]> {
  const dir = brainLayoutIssuesDir(home)
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  const out: IssueListItem[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const p = parseFilename(name)
    if (!p) continue
    try {
      const raw = await readFile(join(dir, name), 'utf-8')
      const { data } = matter(raw)
      const d = data as { title?: unknown; type?: unknown }
      const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : name
      const type = typeof d.type === 'string' ? d.type : undefined
      out.push({
        id: p.id,
        title,
        createdAt: p.createdAt,
        filename: name,
        type,
      })
    } catch {
      out.push({
        id: p.id,
        title: name,
        createdAt: p.createdAt,
        filename: name,
      })
    }
  }
  out.sort((a, b) => b.id - a.id)
  return out
}

export async function getFeedbackIssueById(home: string, id: number): Promise<{ path: string; content: string } | null> {
  const dir = brainLayoutIssuesDir(home)
  if (!existsSync(dir)) return null
  const names = await readdir(dir)
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const p = parseFilename(name)
    if (p?.id === id) {
      const path = join(dir, name)
      const content = await readFile(path, 'utf-8')
      return { path, content }
    }
  }
  return null
}
