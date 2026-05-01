/**
 * Called from `docker-deploy-do.sh` after the deploy git tag exists on HEAD.
 * Loads commits since the previous `deploy-*` tag (or repo root), asks OpenAI for
 * release notes + NR deployment strings, writes `docs/release-notes/<TAG>.md`,
 * and prints bash `export RELEASE_DESCRIPTION=…` / `RELEASE_CHANGELOG=…` lines.
 *
 * On failure (missing key, git/openai errors): exits 0 with no stdout so deploy fallbacks apply.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loadDotEnv } from '../src/server/lib/platform/loadDotEnv'
import { pickPreviousDeployTag } from '../src/server/lib/release-notes-deploy'

const MAX_COMMITS = 150
const DEFAULT_MODEL = 'gpt-4.1-mini'

type LlmPayload = {
  markdown: string
  description: string
  changelog: string
}

function git(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', cwd: process.cwd(), maxBuffer: 12 * 1024 * 1024 }).trimEnd()
}

function exitQuietly(): never {
  process.exit(0)
}

function clampDescription(s: string, max = 160): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function normalizeChangelog(s: string): string {
  const lines = s
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((l) => (l.length > 100 ? `${l.slice(0, 99)}…` : l))
  return lines.join('\n')
}

function parseJsonPayload(raw: string): LlmPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  const markdown = typeof o.markdown === 'string' ? o.markdown : ''
  const description = typeof o.description === 'string' ? o.description : ''
  const changelog = typeof o.changelog === 'string' ? o.changelog : ''
  if (!markdown.trim() || !description.trim()) return null
  return { markdown, description, changelog }
}

async function callOpenAi(commitsText: string, tag: string, previousLabel: string): Promise<LlmPayload | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null

  const model = (process.env.RELEASE_NOTES_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL

  const system = `You write Braintunnel product release notes from git commits. Respond with ONLY a JSON object (no markdown fences) with exactly these string keys:
- "markdown": full markdown document for humans.
- "description": one short sentence for an APM deployment tooltip, at most 160 characters. Include approximate commit count and 2–4 themes (example shape: "18 commits: inbox triage, voice TTS, bug fixes").
- "changelog": newline-separated plain-text lines for an ops changelog (no markdown bullets required), at most 10 lines, each line at most 100 characters, summarizing user-visible or notable changes.

Markdown structure:
- First line: # Braintunnel release notes
- **Release date:** (derive from deploy tag ${tag} when it embeds UTC date/time, otherwise use a sensible date)
- **Changes since:** describe the baseline "${previousLabel}"
- Optional short paragraph.
- ---
- ## What's new
- Several bullets; start major bullets with **bold label** — product language, not raw commit subjects.
- A closing paragraph beginning **Also in this release:** for minor fixes and polish.

Match the tone of docs/release-notes/2026-04-26.md (friendly, product-facing).`

  const user = `Deploy tag: ${tag}
Baseline label for "Changes since": ${previousLabel}

Git commits since baseline (subject + body, truncated at ${MAX_COMMITS} commits):

${commitsText || '(no commits — empty range)'}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(180_000),
  })

  if (!res.ok) return null

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) return null
  return parseJsonPayload(raw)
}

async function main(): Promise<void> {
  loadDotEnv()

  const tag = process.argv[2]?.trim()
  if (!tag || !tag.startsWith('deploy-')) {
    exitQuietly()
  }

  let tagsRaw: string
  let rootSha: string
  try {
    tagsRaw = git(`git tag --list 'deploy-*' --sort=-version:refname`)
    rootSha = git('git rev-list --max-parents=0 HEAD').split('\n')[0]?.trim() ?? ''
  } catch {
    exitQuietly()
  }

  const sortedTags = tagsRaw.split('\n').map((t) => t.trim()).filter(Boolean)
  const previousTag = pickPreviousDeployTag(sortedTags, tag)

  if (!rootSha && !previousTag) exitQuietly()

  let commitsText: string
  try {
    if (previousTag) {
      commitsText = git(
        `git log ${previousTag}..HEAD --format="%H %s%n%b%n---" -n ${MAX_COMMITS}`,
      )
    } else {
      // First deploy-* tag: `root..HEAD` is empty (all commits are reachable from root).
      commitsText = git(`git log -n ${MAX_COMMITS} --format="%H %s%n%b%n---"`)
    }
  } catch {
    exitQuietly()
  }

  const previousLabel = previousTag ?? `repository root (${rootSha.slice(0, 7)})`

  let payload: LlmPayload | null = null
  try {
    payload = await callOpenAi(commitsText, tag, previousLabel)
  } catch {
    exitQuietly()
  }

  if (!payload || !payload.markdown?.trim()) exitQuietly()

  payload.description = clampDescription(payload.description || '')
  payload.changelog = normalizeChangelog(payload.changelog || '')

  if (!payload.description) exitQuietly()

  const outDir = path.join(process.cwd(), 'docs', 'release-notes')
  const outPath = path.join(outDir, `${tag}.md`)
  try {
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(outPath, `${payload.markdown.trim()}\n`, 'utf8')
  } catch {
    exitQuietly()
  }

  process.stdout.write(`export RELEASE_DESCRIPTION=${JSON.stringify(payload.description)}\n`)
  process.stdout.write(`export RELEASE_CHANGELOG=${JSON.stringify(payload.changelog)}\n`)
  process.exit(0)
}

void main()
