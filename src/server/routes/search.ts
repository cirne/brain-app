import { Hono } from 'hono'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { relative, basename } from 'node:path'
import { wikiDir } from '../lib/wikiDir.js'

const execAsync = promisify(exec)
const search = new Hono()
const ripmail = () => process.env.RIPMAIL_BIN ?? 'ripmail'

type WikiResult = { type: 'wiki'; path: string; score: number }
type EmailResult = { type: 'email'; id: string; from: string; subject: string; date: string; snippet: string; score: number }
export type SearchResult = WikiResult | EmailResult

search.get('/', async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q) return c.json({ results: [] })

  const dir = wikiDir()
  const qLower = q.toLowerCase()

  const [wikiResult, emailResult] = await Promise.allSettled([
    execAsync(
      `grep -r --include="*.md" --exclude="_log.md" -ic ${JSON.stringify(q)} ${JSON.stringify(dir)} 2>/dev/null || true`
    ).then(({ stdout }): WikiResult[] =>
      stdout.trim().split('\n')
        .filter(Boolean)
        .map(line => {
          const colon = line.lastIndexOf(':')
          const count = parseInt(line.slice(colon + 1), 10)
          const abs = line.slice(0, colon)
          const path = relative(dir, abs)
          const title = basename(path, '.md').replace(/[-_]/g, ' ').toLowerCase()
          const titleMatch = title.includes(qLower)
          return { type: 'wiki' as const, path, score: count, titleMatch }
        })
        .filter(r => r.score > 0 || r.titleMatch)
        .sort((a, b) => {
          // Title matches always beat non-title matches
          if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1
          return b.score - a.score
        })
        .slice(0, 10)
        .map(({ titleMatch: _tm, ...r }) => r)
    ),
    execAsync(
      `${ripmail()} search ${JSON.stringify(q)} --limit 10 --json`,
      { timeout: 10000 }
    ).then(({ stdout }): EmailResult[] => {
      const data = JSON.parse(stdout)
      return (data.results ?? []).slice(0, 10).map((r: { messageId: string; fromName?: string; fromAddress: string; subject: string; date: string; snippet?: string; rank: number }) => ({
        type: 'email' as const,
        id: r.messageId,
        from: r.fromName || r.fromAddress,
        subject: r.subject,
        date: r.date,
        snippet: r.snippet?.replace(/<[^>]+>/g, '').replace(/\r?\n/g, ' ').trim() ?? '',
        score: r.rank,
      }))
    }),
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
