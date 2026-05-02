import path from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { wikiVaultGlobViaWalk } from '@server/lib/wiki/wikiVaultSymlinkGlob.js'

const execFile = promisify(execFileCallback)
const GREP_MAX_LINE_CHARS = 2000

function resolveSearchAbs(wikiDir: string, searchDirRaw: string | undefined): string {
  return path.resolve(wikiDir, (searchDirRaw ?? '.').trim() || '.')
}

function truncateLine(line: string): string {
  if (line.length <= GREP_MAX_LINE_CHARS) return line
  return `${line.slice(0, GREP_MAX_LINE_CHARS)}…`
}

function lineMatches(
  line: string,
  pattern: string,
  literal: boolean | undefined,
  ignoreCase: boolean | undefined,
): boolean {
  if (literal)
    return ignoreCase ? line.toLowerCase().includes(pattern.toLowerCase()) : line.includes(pattern)
  try {
    return new RegExp(pattern, ignoreCase ? 'i' : undefined).test(line)
  } catch {
    return false
  }
}

async function naiveGrepFiles(params: {
  searchAbs: string
  pattern: string
  ignoreCase?: boolean
  literal?: boolean
  context: number
  limit: number
  glob?: string
  signal?: AbortSignal | null | undefined
}): Promise<{ text: string; matchLimitReached: boolean } | { error: string }> {
  const globPat = params.glob ?? '**/*.md'
  try {
    const files = await wikiVaultGlobViaWalk({
      pattern: globPat,
      searchPathAbs: params.searchAbs,
      limit: 600,
    })

    const linesOut: string[] = []
    let matches = 0
    let matchLimitReached = false

    for (const rel of files) {
      if (params.signal?.aborted) return { error: 'Operation aborted' }
      if (matches >= params.limit) break
      const abs = path.join(params.searchAbs, rel)
      let body: string
      try {
        body = await readFile(abs, 'utf-8')
      } catch {
        continue
      }
      const fileLines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      for (let i = 0; i < fileLines.length; i++) {
        if (matches >= params.limit) {
          matchLimitReached = true
          break
        }
        const lineText = fileLines[i] ?? ''
        if (!lineMatches(lineText, params.pattern, params.literal, params.ignoreCase)) continue
        matches++
        const lineNo = i + 1
        if (params.context > 0) {
          const start = Math.max(1, lineNo - params.context)
          const end = Math.min(fileLines.length, lineNo + params.context)
          for (let c = start; c <= end; c++) {
            const t = fileLines[c - 1] ?? ''
            if (c === lineNo) linesOut.push(`${rel}:${c}: ${truncateLine(t)}`)
            else linesOut.push(`${rel}-${c}- ${truncateLine(t)}`)
          }
        } else {
          linesOut.push(`${rel}:${lineNo}: ${truncateLine(lineText)}`)
        }
      }
      if (matchLimitReached) break
    }

    let text =
      matches === 0 ? 'No matches found' : linesOut.slice(0, params.limit).join('\n')
    if (matches > params.limit || matchLimitReached) {
      text += `\n\n[${params.limit} matches limit reached]`
      matchLimitReached = true
    }
    return { text, matchLimitReached }
  } catch {
    return { error: 'grep failed' }
  }
}

/**
 * Grep semantics aligned with pi-coding-agent `grep`; uses **`rg --follow`** when available so symlinked shares are traversed.
 */
export async function executeWikiSymlinkAwareGrep(
  wikiDir: string,
  params: {
    pattern: string
    path?: string
    glob?: string
    ignoreCase?: boolean
    literal?: boolean
    context?: number
    limit?: number
  },
  signal?: AbortSignal | null | undefined,
): Promise<{ content: { type: 'text'; text: string }[]; details?: { matchLimitReached?: number } }> {
  if (signal?.aborted) throw new Error('Operation aborted')

  const searchAbs = resolveSearchAbs(wikiDir, params.path)
  const ctx = Math.max(0, params.context ?? 0)
  const limit = Math.max(1, params.limit ?? 100)

  const args = [
    '--follow',
    '--line-number',
    '--no-heading',
    '--color=never',
    '--hidden',
    '--max-columns',
    String(GREP_MAX_LINE_CHARS),
    '--max-columns-preview',
  ]
  if (params.ignoreCase) args.push('--ignore-case')
  if (params.literal) args.push('--fixed-strings')
  if (params.glob) args.push('--glob', params.glob)
  if (ctx > 0) args.push('--context', String(ctx))

  args.push(params.pattern)
  args.push(searchAbs)

  try {
    const { stdout } = await execFile('rg', args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      signal: signal ?? undefined,
    })
    const all = stdout.trim().replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
    const clipped = all.slice(0, Math.max(limit * 20, limit + 50))
    const text =
      clipped.length === 0 ? 'No matches found' : `${clipped.join('\n')}${all.length > clipped.length ? `\n\n[truncated output]` : ''}`
    return { content: [{ type: 'text', text }] }
  } catch (err: unknown) {
    if (signal?.aborted) throw new Error('Operation aborted', { cause: err })
    const oe = err as { code?: number; stdout?: string; stderr?: string; message?: string }
    const outStr = typeof oe.stdout === 'string' ? oe.stdout.trim() : ''
    if ((oe.code === 1 || oe.code === undefined) && outStr.length > 0) {
      const all = outStr.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0)
      const clipped = all.slice(0, Math.max(limit * 20, limit + 50))
      return { content: [{ type: 'text', text: clipped.join('\n') }] }
    }
    if (oe.code === 1 && outStr.length === 0) {
      return { content: [{ type: 'text', text: 'No matches found' }] }
    }

    const naive = await naiveGrepFiles({
      searchAbs,
      pattern: params.pattern,
      ignoreCase: params.ignoreCase,
      literal: params.literal,
      context: ctx,
      limit,
      glob: params.glob,
      signal,
    })
    if ('error' in naive) {
      const msg =
        typeof oe.stderr === 'string' && oe.stderr.trim()
          ? oe.stderr.trim()
          : oe.message ?? 'grep failed'
      throw new Error(msg.includes('ENOENT') ? 'ripgrep (rg) is not available on PATH' : msg, {
        cause: err,
      })
    }

    const details =
      naive.matchLimitReached === true ? { matchLimitReached: limit } satisfies { matchLimitReached: number } : undefined
    return { content: [{ type: 'text', text: naive.text }], details }
  }
}
