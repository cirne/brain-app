import { completeSimple, type KnownProvider } from '@mariozechner/pi-ai'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'
import { chainLlmOnPayload } from '@server/lib/llm/llmOnPayloadChain.js'
import { browseHubRipmailFolders, type HubBrowseFolderRow } from './hubRipmailSources.js'

const DEFAULT_PROVIDER = 'openai' as KnownProvider
const DEFAULT_MODEL = 'gpt-5.4-mini'

export type DriveFolderSuggestion = {
  id: string
  name: string
  reason: string
  include: boolean
}

const MAX_IGNORE_GLOBS = 80

export type DriveSuggestResult =
  | { ok: true; suggestions: DriveFolderSuggestion[]; ignoreGlobs: string[]; ignoreSummary: string }
  | { ok: false; error: string }

const SYSTEM_PROMPT = `You are helping configure a personal AI assistant called Braintunnel.
Your job is to look at a list of Google Drive folder names and suggest which ones to index for knowledge retrieval.

Index these types of folders:
- Documents, notes, writing, projects, work files, references, plans, ideas
- Anything a knowledge worker would want to search or ask questions about

Skip these types of folders:
- Photos, videos, audio, media
- Backups, archives, old exports
- Temporary downloads, trash-like folders
- App data, system folders

Also suggest useful ignore glob patterns for Drive file names (e.g. *.tmp, ~$*, media extensions). Keep ignoreGlobs to at most ${MAX_IGNORE_GLOBS} entries — broad patterns preferred over exhaustive lists.

Add "ignoreSummary": one short plain-language sentence for end users explaining what kinds of files will be skipped when those patterns apply (no technical glob syntax).

Respond ONLY with valid JSON matching this exact shape:
{
  "suggested": [
    { "id": "<folder id>", "name": "<folder name>", "reason": "<1 sentence why>", "include": true or false }
  ],
  "ignoreGlobs": ["*.tmp", "~$*"],
  "ignoreSummary": "<one short user-facing sentence, e.g. Skips temporary files, Office locks, unfinished downloads, archives, and common media>"
}

Every input folder must appear in the output "suggested" array. Set "include" to true for folders to index, false for ones to skip.`

function buildUserPrompt(folders: HubBrowseFolderRow[]): string {
  const list = folders
    .map((f) => `- id: ${JSON.stringify(f.id)}  name: ${JSON.stringify(f.name)}`)
    .join('\n')
  return `Here are the top-level Google Drive folders:\n\n${list}\n\nSuggest which ones to index.`
}

function parseSuggestions(
  text: string,
  folders: HubBrowseFolderRow[],
): { suggestions: DriveFolderSuggestion[]; ignoreGlobs: string[]; ignoreSummary: string } | null {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>
  const rawSuggested = Array.isArray(p.suggested) ? p.suggested : []
  const knownIds = new Set(folders.map((f) => f.id))
  const suggestions: DriveFolderSuggestion[] = []
  for (const item of rawSuggested) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const name = typeof o.name === 'string' ? o.name : ''
    const reason = typeof o.reason === 'string' ? o.reason.trim() : ''
    const include = typeof o.include === 'boolean' ? o.include : true
    if (!id || !knownIds.has(id)) continue
    suggestions.push({ id, name: name || id, reason, include })
  }
  let ignoreGlobs = Array.isArray(p.ignoreGlobs)
    ? (p.ignoreGlobs as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  ignoreGlobs = ignoreGlobs.slice(0, MAX_IGNORE_GLOBS)
  const rawSummary = typeof p.ignoreSummary === 'string' ? p.ignoreSummary.trim() : ''
  const ignoreSummary = rawSummary
  return { suggestions, ignoreGlobs, ignoreSummary }
}

export async function suggestDriveFolders(sourceId: string): Promise<DriveSuggestResult> {
  const trimmed = sourceId?.trim()
  if (!trimmed) return { ok: false, error: 'sourceId required' }

  const browsed = await browseHubRipmailFolders(trimmed)
  if (!browsed.ok) return { ok: false, error: `Could not list Drive folders: ${browsed.error}` }
  const folders = browsed.folders
  if (folders.length === 0) {
    return { ok: true, suggestions: [], ignoreGlobs: [], ignoreSummary: '' }
  }

  const provider = (process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER) as KnownProvider
  const modelId = process.env.LLM_MODEL ?? DEFAULT_MODEL
  const model = resolveModel(provider, modelId)
  if (!model) return { ok: false, error: 'LLM not configured' }
  const apiKey = resolveLlmApiKey(provider)
  if (apiKey == null || apiKey === '') return { ok: false, error: 'No API key for current LLM provider' }

  const context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      { role: 'user' as const, content: buildUserPrompt(folders), timestamp: Date.now() },
    ],
  }

  try {
    const msg = await completeSimple(model, context, {
      apiKey,
      maxTokens: 2_000,
      signal: AbortSignal.timeout(60_000),
      onPayload: (params, m) => chainLlmOnPayload(params, m),
    })
    if (msg.stopReason === 'error' || msg.errorMessage) {
      return { ok: false, error: msg.errorMessage ?? 'LLM error' }
    }
    const text =
      msg.content
        ?.filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('')
        .trim() ?? ''

    const parsed = parseSuggestions(text, folders)
    if (!parsed) return { ok: false, error: 'Could not parse LLM response' }

    return {
      ok: true,
      suggestions: parsed.suggestions,
      ignoreGlobs: parsed.ignoreGlobs,
      ignoreSummary: parsed.ignoreSummary,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
