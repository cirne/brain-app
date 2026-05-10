import { Hono } from 'hono'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { join, relative, basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import { wikiToolsDir } from '@server/lib/wiki/wikiDir.js'
import { buildWikiExcerpt } from '@server/lib/wiki/wikiSearchExcerpt.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { ripmailSearch } from '@server/ripmail/index.js'

const execAsync = promisify(exec)
const search = new Hono()

type WikiResult = { type: 'wiki'; path: string; score: number; excerpt: string }
type EmailResult = { type: 'email'; id: string; from: string; subject: string; date: string; snippet: string; score: number }
export type SearchResult = WikiResult | EmailResult

search.get('/', async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json({ results: [] })

  const dir = wikiToolsDir()
  const qLower = q.toLowerCase()

  const [wikiResult, emailResult] = await Promise.allSettled([
    execAsync(
      `grep -r --include="*.md" --exclude="_log.md" -ic ${JSON.stringify(q)} ${JSON.stringify(dir)} 2>/dev/null || true`
    ).then(async ({ stdout }): Promise<WikiResult[]> => {
      const candidates = stdout.trim().split('\n')
        .filter(Boolean)
        .map(line => {
          const colon = line.lastIndexOf(':')
          const count = parseInt(line.slice(colon + 1), 10)
          const abs = line.slice(0, colon)
          const path = relative(dir, abs)
          const title = basename(path, '.md').replace(/[-_]/g, ' ').toLowerCase()
          const titleMatch = title.includes(qLower)
          return { path, score: count, titleMatch }
        })
        .filter(r => r.score > 0 || r.titleMatch)
        .sort((a, b) => {
          if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1
          return b.score - a.score
        })
        .slice(0, 10)

      return Promise.all(
        candidates.map(async ({ path, score }) => {
          try {
            const raw = await readFile(join(dir, path), 'utf-8')
            const excerpt = buildWikiExcerpt(raw, q)
            return { type: 'wiki' as const, path, score, excerpt }
          } catch {
            return { type: 'wiki' as const, path, score, excerpt: '' }
          }
        })
      )
    }),
    ripmailSearch(ripmailHomeForBrain(), { query: q, limit: 10, includeAll: false })
      .then((data): EmailResult[] =>
        (data.results ?? []).slice(0, 10).map((r) => ({
          type: 'email' as const,
          id: r.messageId,
          from: r.fromName || r.fromAddress,
          subject: r.subject,
          date: r.date,
          snippet: r.snippet?.replace(/<[^>]+>/g, '').replace(/\r?\n/g, ' ').trim() ?? '',
          score: r.rank,
        }))
      ),
  ])

  const wiki = wikiResult.status === 'fulfilled' ? wikiResult.value : []
  const emails = emailResult.status === 'fulfilled' ? emailResult.value : []

  // Title-matching wiki docs go first, then zip remaining wiki + emails
  const titleMatches: WikiResult[] = []
  const wikiRest: WikiResult[] = []

  for (const w of wiki) {
    const title = basename(w.path, '.md').replace(/[-_]/g, ' ').toLowerCase()
    if (title.includes(qLower)) titleMatches.push(w)
    else wikiRest.push(w)
  }

  const results: SearchResult[] = [...titleMatches]
  const len = Math.max(wikiRest.length, emails.length)
  for (let i = 0; i < len; i++) {
    if (i < wikiRest.length) results.push(wikiRest[i])
    if (i < emails.length) results.push(emails[i])
  }

  return c.json({ results })
})

export default search
