/**
 * Braintunnel OpenAI **project** Usage + Costs (admin API) for `npm run llm:usage`.
 * Filters to {@link getBrainOpenAiProjectId} (`BRAIN_OPENAI_PROJECT_ID` or {@link BRAIN_OPENAI_PROJECT_ID_DEFAULT}); no org-wide mode.
 * @see https://platform.openai.com/docs/api-reference/usage/completions
 * @see https://platform.openai.com/docs/api-reference/usage/costs
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOpenAiJsonText, usageBucketRows } from './openaiOrgUsageParse.js'

const API_BASE = 'https://api.openai.com/v1'

/** Braintunnel OpenAI project — default when `BRAIN_OPENAI_PROJECT_ID` is unset; the only project `llm:usage` reports on. */
export const BRAIN_OPENAI_PROJECT_ID_DEFAULT = 'proj_cuDNhdtS2h6Ek2pt4YSDKFHQ'

/** Resolved OpenAI project id for Usage/Costs CLI (env override for forks/operators). */
export function getBrainOpenAiProjectId(): string {
  const raw = process.env.BRAIN_OPENAI_PROJECT_ID?.trim()
  return raw || BRAIN_OPENAI_PROJECT_ID_DEFAULT
}

function brainOpenAiScopeLabel(): string {
  const id = getBrainOpenAiProjectId()
  const hint =
    id === BRAIN_OPENAI_PROJECT_ID_DEFAULT
      ? 'BRAIN_OPENAI_PROJECT_ID_DEFAULT in openaiOrgUsage.ts'
      : 'BRAIN_OPENAI_PROJECT_ID'
  return `Braintunnel only — OpenAI project ${id} (see ${hint})`
}

/** Completions: max daily buckets per request (OpenAI Usage API; bucket_width=1d). */
const MAX_COMPLETION_DAYS = 31
/** Costs: max daily buckets per request. */
const MAX_COST_DAYS = 180
const SEC = 1
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function loadRepoDotEnv(): void {
  const root = findRepoRoot()
  for (const name of ['.env', '.env.local']) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i <= 0) continue
      const k = t.slice(0, i).trim()
      if (process.env[k] !== undefined) continue
      let v = t.slice(i + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      process.env[k] = v
    }
  }
}

function findRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
}

const REL = /^(\d+)([dhw])$/i

/**
 * Human window like `7d`, `24h`, `2w` → length in seconds.
 */
export function parseRelativeWindow(s: string): number {
  const m = s.trim().match(REL)
  if (!m) throw new Error(`Invalid --since/--until value "${s}" (use e.g. 7d, 24h, 2w)`)
  const n = Number(m[1])
  const u = m[2].toLowerCase()
  const mult = u === 'd' ? DAY : u === 'h' ? HOUR : u === 'w' ? WEEK : 0
  if (!mult) throw new Error(`Invalid unit in "${s}"`)
  return n * mult
}

/**
 * --since: relative duration (default 7d) = now - duration to now.
 * Or absolute start: ISO date `YYYY-MM-DD` (UTC midnight).
 */
export function parseSince(s: string | undefined, nowSec: number): number {
  const raw = (s ?? '7d').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(`${raw}T00:00:00.000Z`)
    if (Number.isNaN(t)) throw new Error(`Invalid date: ${raw}`)
    return Math.floor(t / 1000)
  }
  if (REL.test(raw)) {
    return nowSec - parseRelativeWindow(raw)
  }
  throw new Error(`Invalid --since "${raw}" (use 7d, 24h, 2w, or YYYY-MM-DD)`)
}

/**
 * --until: default now; or relative offset from now (`1d` = now - 1d as end? No: "until" is end of range, exclusive in API; use absolute).
 * Accept: `now`, YYYY-MM-DD, or a relative span meaning "end = now" only if `now` keyword.
 * For simplicity: `now` = now, `YYYY-MM-DD` = end of that UTC day exclusive next day, or `7d` means now (same as now)? User expects --until 2024-12-01 = through that day.
 */
export function parseUntil(s: string | undefined, nowSec: number): number {
  if (s === undefined || s === '' || s.trim() === 'now') return nowSec
  const raw = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(`${raw}T00:00:00.000Z`)
    if (Number.isNaN(t)) throw new Error(`Invalid date: ${raw}`)
    return Math.floor(t / 1000) + DAY
  }
  if (REL.test(raw)) {
    void parseRelativeWindow(raw)
  }
  throw new Error(
    `Invalid --until "${raw}" (use now, YYYY-MM-DD, or omit for "now" as end exclusive)`,
  )
}

export type CompletionAgg = {
  model: string
  inputTokens: number
  outputTokens: number
  inputCachedTokens: number
  inputAudioTokens: number
  outputAudioTokens: number
  numModelRequests: number
}

/** Completions from Usage API with `group_by=api_key_id`. */
export type ApiKeyCompletionAgg = {
  apiKeyId: string
  inputTokens: number
  outputTokens: number
  inputCachedTokens: number
  inputAudioTokens: number
  outputAudioTokens: number
  numModelRequests: number
}

export type AdminApiKeyMeta = {
  name: string
  redactedValue: string
  lastUsedAt: number | null
}

export type LineItemCost = { lineItem: string; usd: number; currency: string }

function addCompletionAgg(
  m: Map<string, CompletionAgg>,
  r: {
    model?: string | null
    input_tokens?: number
    output_tokens?: number
    input_cached_tokens?: number
    input_audio_tokens?: number
    output_audio_tokens?: number
    num_model_requests?: number
  },
): void {
  const model = (r.model ?? 'unknown') || 'unknown'
  const cur =
    m.get(model) ??
    {
      model,
      inputTokens: 0,
      outputTokens: 0,
      inputCachedTokens: 0,
      inputAudioTokens: 0,
      outputAudioTokens: 0,
      numModelRequests: 0,
    }
  cur.inputTokens += r.input_tokens ?? 0
  cur.outputTokens += r.output_tokens ?? 0
  cur.inputCachedTokens += r.input_cached_tokens ?? 0
  cur.inputAudioTokens += r.input_audio_tokens ?? 0
  cur.outputAudioTokens += r.output_audio_tokens ?? 0
  cur.numModelRequests += r.num_model_requests ?? 0
  m.set(model, cur)
}

function addApiKeyCompletionAgg(
  m: Map<string, ApiKeyCompletionAgg>,
  r: {
    api_key_id?: string | null
    input_tokens?: number
    output_tokens?: number
    input_cached_tokens?: number
    input_audio_tokens?: number
    output_audio_tokens?: number
    num_model_requests?: number
  },
): void {
  const id = (r.api_key_id ?? 'unknown') || 'unknown'
  const cur =
    m.get(id) ??
    {
      apiKeyId: id,
      inputTokens: 0,
      outputTokens: 0,
      inputCachedTokens: 0,
      inputAudioTokens: 0,
      outputAudioTokens: 0,
      numModelRequests: 0,
    }
  cur.inputTokens += r.input_tokens ?? 0
  cur.outputTokens += r.output_tokens ?? 0
  cur.inputCachedTokens += r.input_cached_tokens ?? 0
  cur.inputAudioTokens += r.input_audio_tokens ?? 0
  cur.outputAudioTokens += r.output_audio_tokens ?? 0
  cur.numModelRequests += r.num_model_requests ?? 0
  m.set(id, cur)
}

/** API may return `amount.value` as string. */
export function amountValueToNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function addLineItem(
  m: Map<string, number>,
  r: { line_item?: string | null; amount?: { value?: unknown; currency?: string } | null },
  _currency: { value: string },
): void {
  const key = (r.line_item ?? 'unknown') || 'unknown'
  const v = amountValueToNumber(r.amount?.value)
  m.set(key, (m.get(key) ?? 0) + v)
  if (r.amount?.currency) _currency.value = r.amount.currency
}

type FetchOpts = { key: string; signal?: AbortSignal }

async function fetchJson(
  pathWithQuery: string,
  { key, signal }: FetchOpts,
): Promise<unknown> {
  const r = await fetch(`${API_BASE}${pathWithQuery}`, {
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
    },
  })
  const text = await r.text()
  if (!r.ok) {
    throw new Error(`OpenAI ${r.status}: ${text.slice(0, 500)}`)
  }
  const parsed = parseOpenAiJsonText(text)
  if (!parsed.ok) {
    throw new Error(`OpenAI JSON parse: ${parsed.error}`)
  }
  return parsed.value
}

/** Split [start, end) into chunks of at most `maxSpanSec` seconds (non-overlapping). */
export function splitTimeRange(
  startSec: number,
  endSec: number,
  maxSpanSec: number,
): { chunkStart: number; chunkEnd: number }[] {
  if (endSec <= startSec) return []
  const out: { chunkStart: number; chunkEnd: number }[] = []
  let t = startSec
  while (t < endSec) {
    const chunkEnd = Math.min(t + maxSpanSec, endSec)
    out.push({ chunkStart: t, chunkEnd })
    t = chunkEnd
  }
  return out
}

function buildCompletionsParams(
  chunkStart: number,
  chunkEnd: number,
  opts: {
    models: string[]
    projectIds: string[]
    userIds: string[]
  },
): string {
  const p = new URLSearchParams()
  p.set('start_time', String(chunkStart))
  p.set('end_time', String(chunkEnd))
  p.set('bucket_width', '1d')
  p.append('group_by', 'model')
  p.set('limit', String(Math.min(Math.ceil((chunkEnd - chunkStart) / DAY), MAX_COMPLETION_DAYS)))
  for (const m of opts.models) p.append('models', m)
  for (const id of opts.projectIds) p.append('project_ids', id)
  for (const id of opts.userIds) p.append('user_ids', id)
  return p.toString()
}

function buildCompletionsParamsByApiKey(
  chunkStart: number,
  chunkEnd: number,
  opts: {
    models: string[]
    projectIds: string[]
    userIds: string[]
  },
): string {
  const p = new URLSearchParams()
  p.set('start_time', String(chunkStart))
  p.set('end_time', String(chunkEnd))
  p.set('bucket_width', '1d')
  p.append('group_by', 'api_key_id')
  p.set('limit', String(Math.min(Math.ceil((chunkEnd - chunkStart) / DAY), MAX_COMPLETION_DAYS)))
  for (const m of opts.models) p.append('models', m)
  for (const id of opts.projectIds) p.append('project_ids', id)
  for (const id of opts.userIds) p.append('user_ids', id)
  return p.toString()
}

function buildCostsParams(
  chunkStart: number,
  chunkEnd: number,
  projectIds: string[],
): string {
  const p = new URLSearchParams()
  p.set('start_time', String(chunkStart))
  p.set('end_time', String(chunkEnd))
  p.set('bucket_width', '1d')
  p.append('group_by', 'line_item')
  p.set('limit', String(Math.min(Math.ceil((chunkEnd - chunkStart) / DAY), MAX_COST_DAYS)))
  for (const id of projectIds) p.append('project_ids', id)
  return p.toString()
}

async function fetchAllCompletionsInChunk(
  key: string,
  chunkStart: number,
  chunkEnd: number,
  opts: { models: string[]; projectIds: string[]; userIds: string[] },
  signal?: AbortSignal,
): Promise<CompletionAgg[]> {
  const agg = new Map<string, CompletionAgg>()
  let page: string | undefined
  for (;;) {
    const qs = buildCompletionsParams(chunkStart, chunkEnd, opts)
    const u =
      page !== undefined
        ? `/organization/usage/completions?${qs}&page=${encodeURIComponent(page)}`
        : `/organization/usage/completions?${qs}`
    const body = (await fetchJson(u, { key, signal })) as {
      data?: { result?: unknown[]; start_time?: number; end_time?: number }[]
      has_more?: boolean
      next_page?: string
    }
    for (const bucket of body.data ?? []) {
      for (const row of usageBucketRows(bucket)) {
        addCompletionAgg(agg, row)
      }
    }
    if (!body.has_more || !body.next_page) break
    page = body.next_page
  }
  return Array.from(agg.values()).sort((a, b) => b.inputTokens - a.inputTokens)
}

async function fetchAllCompletionsByApiKeyInChunk(
  key: string,
  chunkStart: number,
  chunkEnd: number,
  opts: { models: string[]; projectIds: string[]; userIds: string[] },
  signal?: AbortSignal,
): Promise<ApiKeyCompletionAgg[]> {
  const agg = new Map<string, ApiKeyCompletionAgg>()
  let page: string | undefined
  for (;;) {
    const qs = buildCompletionsParamsByApiKey(chunkStart, chunkEnd, opts)
    const u =
      page !== undefined
        ? `/organization/usage/completions?${qs}&page=${encodeURIComponent(page)}`
        : `/organization/usage/completions?${qs}`
    const body = (await fetchJson(u, { key, signal })) as {
      data?: { result?: unknown[]; start_time?: number; end_time?: number }[]
      has_more?: boolean
      next_page?: string
    }
    for (const bucket of body.data ?? []) {
      for (const row of usageBucketRows(bucket)) {
        addApiKeyCompletionAgg(agg, row)
      }
    }
    if (!body.has_more || !body.next_page) break
    page = body.next_page
  }
  return Array.from(agg.values()).sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
}

async function fetchAllCompletionsByApiKey(
  key: string,
  startSec: number,
  endSec: number,
  opts: { models: string[]; projectIds: string[]; userIds: string[] },
  signal?: AbortSignal,
): Promise<Map<string, ApiKeyCompletionAgg>> {
  const total = new Map<string, ApiKeyCompletionAgg>()
  for (const { chunkStart, chunkEnd } of splitTimeRange(
    startSec,
    endSec,
    MAX_COMPLETION_DAYS * DAY,
  )) {
    const rows = await fetchAllCompletionsByApiKeyInChunk(
      key,
      chunkStart,
      chunkEnd,
      opts,
      signal,
    )
    for (const r of rows) {
      const cur =
        total.get(r.apiKeyId) ??
        ({
          apiKeyId: r.apiKeyId,
          inputTokens: 0,
          outputTokens: 0,
          inputCachedTokens: 0,
          inputAudioTokens: 0,
          outputAudioTokens: 0,
          numModelRequests: 0,
        } as ApiKeyCompletionAgg)
      cur.inputTokens += r.inputTokens
      cur.outputTokens += r.outputTokens
      cur.inputCachedTokens += r.inputCachedTokens
      cur.inputAudioTokens += r.inputAudioTokens
      cur.outputAudioTokens += r.outputAudioTokens
      cur.numModelRequests += r.numModelRequests
      total.set(r.apiKeyId, cur)
    }
  }
  return total
}

/**
 * All org + project API keys (names, redacted prefix, `last_used_at`) for resolving Usage `api_key_id`.
 * Requires a key with permission to list admin API keys.
 */
export async function fetchAllAdminApiKeyMeta(
  key: string,
  signal?: AbortSignal,
): Promise<Map<string, AdminApiKeyMeta>> {
  const out = new Map<string, AdminApiKeyMeta>()
  let after: string | undefined
  for (;;) {
    const p = new URLSearchParams()
    p.set('limit', '100')
    if (after) p.set('after', after)
    const body = (await fetchJson(`/organization/admin_api_keys?${p}`, { key, signal })) as {
      data?: {
        id: string
        name?: string | null
        redacted_value?: string | null
        last_used_at?: number | null
      }[]
      has_more?: boolean
      last_id?: string
    }
    for (const row of body.data ?? []) {
      if (!row.id) continue
      out.set(row.id, {
        name: (row.name ?? '').trim() || '(unnamed)',
        redactedValue: (row.redacted_value ?? '').trim() || '—',
        lastUsedAt:
          row.last_used_at != null && Number.isFinite(row.last_used_at) ? row.last_used_at : null,
      })
    }
    if (!body.has_more || !body.last_id) break
    after = body.last_id
  }
  return out
}

async function fetchAllCompletions(
  key: string,
  startSec: number,
  endSec: number,
  opts: { models: string[]; projectIds: string[]; userIds: string[] },
  signal?: AbortSignal,
): Promise<Map<string, CompletionAgg>> {
  const total = new Map<string, CompletionAgg>()
  for (const { chunkStart, chunkEnd } of splitTimeRange(
    startSec,
    endSec,
    MAX_COMPLETION_DAYS * DAY,
  )) {
    const rows = await fetchAllCompletionsInChunk(key, chunkStart, chunkEnd, opts, signal)
    for (const r of rows) {
      const cur =
        total.get(r.model) ??
        ({
          model: r.model,
          inputTokens: 0,
          outputTokens: 0,
          inputCachedTokens: 0,
          inputAudioTokens: 0,
          outputAudioTokens: 0,
          numModelRequests: 0,
        } as CompletionAgg)
      cur.inputTokens += r.inputTokens
      cur.outputTokens += r.outputTokens
      cur.inputCachedTokens += r.inputCachedTokens
      cur.inputAudioTokens += r.inputAudioTokens
      cur.outputAudioTokens += r.outputAudioTokens
      cur.numModelRequests += r.numModelRequests
      total.set(r.model, cur)
    }
  }
  return total
}

async function fetchAllCostsInChunk2(
  key: string,
  chunkStart: number,
  chunkEnd: number,
  projectIds: string[],
  signal?: AbortSignal,
): Promise<{ lineToUsd: Map<string, number>; currency: string }> {
  const lineToUsd = new Map<string, number>()
  const currency: { value: string } = { value: 'usd' }
  let page: string | undefined
  for (;;) {
    const qs = buildCostsParams(chunkStart, chunkEnd, projectIds)
    const u =
      page !== undefined
        ? `/organization/costs?${qs}&page=${encodeURIComponent(page)}`
        : `/organization/costs?${qs}`
    const body = (await fetchJson(u, { key, signal })) as {
      data?: { result?: unknown[] }[]
      has_more?: boolean
      next_page?: string
    }
    for (const bucket of body.data ?? []) {
      for (const row of usageBucketRows(bucket)) {
        addLineItem(
          lineToUsd,
          row as { line_item?: string | null; amount?: { value?: number; currency?: string } | null },
          currency,
        )
      }
    }
    if (!body.has_more || !body.next_page) break
    page = body.next_page
  }
  return { lineToUsd, currency: currency.value }
}

async function fetchAllCosts(
  key: string,
  startSec: number,
  endSec: number,
  projectIds: string[],
  signal?: AbortSignal,
): Promise<LineItemCost[]> {
  const merged = new Map<string, number>()
  let currency = 'usd'
  for (const { chunkStart, chunkEnd } of splitTimeRange(
    startSec,
    endSec,
    MAX_COST_DAYS * DAY,
  )) {
    const { lineToUsd, currency: c } = await fetchAllCostsInChunk2(
      key,
      chunkStart,
      chunkEnd,
      projectIds,
      signal,
    )
    currency = c
    for (const [k, v] of lineToUsd) merged.set(k, (merged.get(k) ?? 0) + v)
  }
  return Array.from(merged.entries())
    .map(([lineItem, usd]) => ({
      lineItem,
      usd: amountValueToNumber(usd),
      currency,
    }))
    .sort((a, b) => b.usd - a.usd)
}

export type LlmUsageCliOptions = {
  provider: 'openai'
  since: string | undefined
  until: string | undefined
  /** Default `model` = `group_by=model`. `api-key` = `group_by=api_key_id` with admin key name lookup. */
  facet: 'model' | 'api-key'
  models: string[]
  userIds: string[]
  json: boolean
  help: boolean
}

export function parseLlmUsageArgv(argv: string[]): LlmUsageCliOptions {
  const out: LlmUsageCliOptions = {
    provider: 'openai',
    since: undefined,
    until: undefined,
    facet: 'model',
    models: [],
    userIds: [],
    json: false,
    help: false,
  }
  const args = argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-h' || a === '--help') {
      out.help = true
      continue
    }
    if (a === '--json') {
      out.json = true
      continue
    }
    if (a === '--facet') {
      const v = (args[++i] ?? '').trim().toLowerCase()
      if (v === 'model' || v === 'by-model') {
        out.facet = 'model'
        continue
      }
      if (v === 'api-key' || v === 'apikey' || v === 'key') {
        out.facet = 'api-key'
        continue
      }
      throw new Error(
        `Invalid --facet "${v}" (use model, api-key — completions grouped by model vs API key id)`,
      )
    }
    if (a === '--provider') {
      out.provider = (args[++i] as 'openai') ?? 'openai'
      if (out.provider !== 'openai') throw new Error('Only --provider openai is supported')
      continue
    }
    if (a === '--since') {
      out.since = args[++i]
      continue
    }
    if (a === '--until') {
      out.until = args[++i]
      continue
    }
    if (a === '--model') {
      out.models.push(args[++i] ?? '')
      continue
    }
    if (a === '--user-id') {
      out.userIds.push(args[++i] ?? '')
      continue
    }
    throw new Error(`Unknown argument: ${a} (use --help)`)
  }
  return out
}

const HELP = `Usage: npm run llm:usage -- [options]

OpenAI project usage (requires OPENAI_ADMIN_API_KEY in .env or env).
**Always** reports a single OpenAI project (default ${BRAIN_OPENAI_PROJECT_ID_DEFAULT};
override with BRAIN_OPENAI_PROJECT_ID); there is no org-wide or other-project mode.

Options:
  --provider openai     Default: openai (only value supported)
  --since <window|date>  Start of range: e.g. 7d, 24h, 2w, or YYYY-MM-DD (UTC). Default: 7d
  --until <now|date>   End of range (exclusive, API): default now, or YYYY-MM-DD
  --model <id>         Repeat to filter to specific models
  --user-id <id>      Repeat: OpenAI request user_id filter (if your app sets it)
  --facet model       Group completions by model (default; same as --group_by=model)
  --facet api-key     Group completions by API key id; resolves key names via admin API
  --json               Machine-readable output
  -h, --help           This message

Env (repo .env / .env.local):
  OPENAI_ADMIN_API_KEY     Required. Org admin or usage access.
  BRAIN_OPENAI_PROJECT_ID   Optional. OpenAI project id for Usage/Costs filters (default: built-in Braintunnel project).
`

function fmtUtc(sec: number): string {
  return new Date(sec * 1000).toISOString()
}

function printText(
  startSec: number,
  endSec: number,
  projectLabel: string,
  completion: Map<string, CompletionAgg>,
  costs: LineItemCost[],
): void {
  console.log('OpenAI project usage (admin API) — Braintunnel only')
  console.log(`Range: ${fmtUtc(startSec)} → ${fmtUtc(endSec)} (end exclusive) UTC`)
  console.log(`Scope: ${projectLabel}`)
  console.log('')
  console.log('## Completion tokens by model')
  console.log('model\ttin\ttout\tcache\t#req')
  for (const r of Array.from(completion.values()).sort(
    (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  )) {
    console.log(
      [
        r.model,
        r.inputTokens,
        r.outputTokens,
        r.inputCachedTokens,
        r.numModelRequests,
      ].join('\t'),
    )
  }
  const tin = sum(completion, (x) => x.inputTokens)
  const tout = sum(completion, (x) => x.outputTokens)
  const tc = sum(completion, (x) => x.inputCachedTokens)
  const nreq = sum(completion, (x) => x.numModelRequests)
  console.log(`TOTAL\ttin=${tin}\ttout=${tout}\tcache=${tc}\t#req=${nreq}`)
  console.log('')
  console.log('## Cost (API line items, currency from OpenAI)')
  console.log('line_item\tamount')
  let totalCost = 0
  for (const c of costs) {
    console.log([c.lineItem, c.usd.toFixed(4)].join('\t'))
    totalCost += c.usd
  }
  console.log(`TOTAL_USD\t${totalCost.toFixed(4)}`)
  console.log('')
  console.log(
    'Note: per-model $ is not in the Costs API; use line items + tokens for attribution.',
  )
}

function printTextByApiKey(
  startSec: number,
  endSec: number,
  projectLabel: string,
  modelFilterDesc: string,
  completion: Map<string, ApiKeyCompletionAgg>,
  nameById: Map<string, AdminApiKeyMeta>,
  keyListFailed: string | undefined,
): void {
  console.log('OpenAI project usage (admin API) — Braintunnel only')
  console.log(`Range: ${fmtUtc(startSec)} → ${fmtUtc(endSec)} (end exclusive) UTC`)
  console.log(`Scope: ${projectLabel}`)
  console.log(`Facet: api_key (Usage API group_by=api_key_id)${modelFilterDesc}`)
  if (keyListFailed) {
    console.log(`Key names: (could not list admin keys — ${keyListFailed}; ids are still shown.)`)
  }
  console.log('')
  console.log('## Completion tokens by API key')
  console.log('name\tredacted_value\tapi_key_id\tlast_used (UTC)\ttin\ttout\tcache\t#req')
  for (const r of Array.from(completion.values()).sort(
    (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  )) {
    const meta = nameById.get(r.apiKeyId)
    const name = meta?.name ?? '(name unknown — not in list or revoked key)'
    const redacted = meta?.redactedValue ?? '—'
    const lu =
      meta?.lastUsedAt != null
        ? new Date(meta.lastUsedAt * 1000).toISOString()
        : '—'
    console.log(
      [
        name,
        redacted,
        r.apiKeyId,
        lu,
        r.inputTokens,
        r.outputTokens,
        r.inputCachedTokens,
        r.numModelRequests,
      ].join('\t'),
    )
  }
  const tin = sumByApiKey(completion, (x) => x.inputTokens)
  const tout = sumByApiKey(completion, (x) => x.outputTokens)
  const tc = sumByApiKey(completion, (x) => x.inputCachedTokens)
  const nreq = sumByApiKey(completion, (x) => x.numModelRequests)
  console.log(`TOTAL\ttin=${tin}\ttout=${tout}\tcache=${tc}\t#req=${nreq}`)
  console.log('')
  console.log('Match "name" to how you label keys in platform.openai.com (e.g. dev vs prod).')
  console.log(
    'Note: with --model filter, totals are only for those models; omit --model for all models per key.',
  )
}

function sum(m: Map<string, CompletionAgg>, f: (x: CompletionAgg) => number): number {
  let s = 0
  for (const v of m.values()) s += f(v)
  return s
}

function sumByApiKey(
  m: Map<string, ApiKeyCompletionAgg>,
  f: (x: ApiKeyCompletionAgg) => number,
): number {
  let s = 0
  for (const v of m.values()) s += f(v)
  return s
}

export async function runLlmUsageCli(argv: string[]): Promise<void> {
  loadRepoDotEnv()
  let opt: LlmUsageCliOptions
  try {
    opt = parseLlmUsageArgv(argv)
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
    return
  }
  if (opt.help) {
    console.log(HELP)
    return
  }
  if (opt.provider !== 'openai') {
    console.error('Only --provider openai is supported')
    process.exit(1)
    return
  }
  const key = process.env.OPENAI_ADMIN_API_KEY?.trim()
  if (!key) {
    console.error('Set OPENAI_ADMIN_API_KEY in .env or the environment (org admin / usage access).')
    process.exit(1)
    return
  }
  const nowSec = Math.floor(Date.now() / 1000)
  const startSec = parseSince(opt.since, nowSec)
  const endSec = parseUntil(opt.until, nowSec)
  if (endSec <= startSec) {
    console.error('Invalid range: end must be after start')
    process.exit(1)
    return
  }

  const modelFilter = opt.models.map((m) => m.trim()).filter(Boolean)
  const userIds = opt.userIds.map((m) => m.trim()).filter(Boolean)
  const projectIds = [getBrainOpenAiProjectId()]
  const fetchOpts = { models: modelFilter, projectIds, userIds }

  if (opt.facet === 'api-key') {
    let keyListFailed: string | undefined
    const [byKey, costs, nameById] = await Promise.all([
      fetchAllCompletionsByApiKey(key, startSec, endSec, fetchOpts),
      fetchAllCosts(key, startSec, endSec, projectIds),
      fetchAllAdminApiKeyMeta(key).catch((e) => {
        keyListFailed = (e as Error).message
        return new Map<string, AdminApiKeyMeta>()
      }),
    ])
    const modelFilterDesc =
      modelFilter.length > 0 ? `; models: ${modelFilter.join(', ')}` : '; models: (all)'

    if (opt.json) {
      const apiKeyRows = Object.fromEntries(
        Array.from(byKey.values()).map((r) => {
          const m = nameById.get(r.apiKeyId)
          return [
            r.apiKeyId,
            {
              ...r,
              name: m?.name,
              redactedValue: m?.redactedValue,
              lastUsedAt: m?.lastUsedAt,
            },
          ] as const
        }),
      )
      console.log(
        JSON.stringify(
          {
            provider: 'openai' as const,
            facet: 'api-key' as const,
            startTime: startSec,
            endTime: endSec,
            projectId: getBrainOpenAiProjectId(),
            scope: 'braintunnel_only' as const,
            modelFilter: modelFilter.length > 0 ? modelFilter : null,
            adminKeyListError: keyListFailed ?? null,
            completionByApiKey: apiKeyRows,
            allOrgApiKeys: Object.fromEntries(nameById),
            costsByLineItem: costs,
            totals: {
              inputTokens: sumByApiKey(byKey, (x) => x.inputTokens),
              outputTokens: sumByApiKey(byKey, (x) => x.outputTokens),
              inputCachedTokens: sumByApiKey(byKey, (x) => x.inputCachedTokens),
              numModelRequests: sumByApiKey(byKey, (x) => x.numModelRequests),
              usd: costs.reduce((a, c) => a + c.usd, 0),
            },
          },
          null,
          2,
        ),
      )
    } else {
      printTextByApiKey(
        startSec,
        endSec,
        brainOpenAiScopeLabel(),
        modelFilterDesc,
        byKey,
        nameById,
        keyListFailed,
      )
      console.log('')
      console.log('## Cost (API line items, org + project; not split by key)')
      console.log('line_item\tamount')
      let totalCost = 0
      for (const c of costs) {
        console.log([c.lineItem, c.usd.toFixed(4)].join('\t'))
        totalCost += c.usd
      }
      console.log(`TOTAL_USD\t${totalCost.toFixed(4)}`)
    }
    return
  }

  const [compMap, costs] = await Promise.all([
    fetchAllCompletions(key, startSec, endSec, fetchOpts),
    fetchAllCosts(key, startSec, endSec, projectIds),
  ])

  if (opt.json) {
    console.log(
      JSON.stringify(
        {
          provider: 'openai' as const,
          facet: 'model' as const,
          startTime: startSec,
          endTime: endSec,
          projectId: getBrainOpenAiProjectId(),
          scope: 'braintunnel_only' as const,
          completionByModel: Object.fromEntries(compMap),
          costsByLineItem: costs,
          totals: {
            inputTokens: sum(compMap, (x) => x.inputTokens),
            outputTokens: sum(compMap, (x) => x.outputTokens),
            inputCachedTokens: sum(compMap, (x) => x.inputCachedTokens),
            numModelRequests: sum(compMap, (x) => x.numModelRequests),
            usd: costs.reduce((a, c) => a + c.usd, 0),
          },
        },
        null,
        2,
      ),
    )
  } else {
    printText(startSec, endSec, brainOpenAiScopeLabel(), compMap, costs)
  }
}