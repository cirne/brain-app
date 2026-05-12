/**
 * Shared `.env` load + `--provider` / `--model` / `--fastLlm` / `--help` for eval CLIs (same as dev server env).
 */
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { loadDotEnv } from '@server/lib/platform/loadDotEnv.js'
import { getDefaultLlmModelForProvider } from './supportedLlmModels.js'

/**
 * Turn off the New Relic Node agent for eval CLIs unless **`BRAIN_EVAL_ENABLE_NEW_RELIC=1`**.
 * Avoids IMDS / vendor metadata noise (`169.254.169.254`, `metadata.google.internal`) and
 * extra collector sessions when running LLM JSONL or Vitest eval slices.
 */
export function applyEvalNewRelicDefaults(): void {
  if (process.env.BRAIN_EVAL_ENABLE_NEW_RELIC === '1') return
  process.env.NEW_RELIC_ENABLED = 'false'
}

applyEvalNewRelicDefaults()
/**
 * `node:util` parseArgs maps option `brainWikiRoot` to CLI `--brainWikiRoot` for string values.
 * `--brain-wiki-root` is incorrectly parsed as a boolean and the path becomes a positional — so read the path from argv.
 */
export function extractBrainWikiRootFromArgv(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--brain-wiki-root=')) {
      const rest = a.slice('--brain-wiki-root='.length)
      if (rest.trim()) return rest
      continue
    }
    if (a.startsWith('--brainWikiRoot=')) {
      const rest = a.slice('--brainWikiRoot='.length)
      if (rest.trim()) return rest
      continue
    }
    if ((a === '--brain-wiki-root' || a === '--brainWikiRoot') && i < argv.length - 1) {
      const v = argv[i + 1]
      if (v && !v.startsWith('-')) return v
    }
  }
  return undefined
}

export const evalCliParseOptions = {
  provider: { type: 'string' as const, short: 'p' as const },
  model: { type: 'string' as const, short: 'm' as const },
  /** Optional fast tier (same as `BRAIN_FAST_LLM`), e.g. `haiku` or `openai/gpt-5.4-nano`. */
  fastLlm: { type: 'string' as const },
  help: { type: 'boolean' as const, short: 'h' as const },
  /** Run a single case by `id` from the JSONL (sets `EVAL_CASE_ID` for the harness). */
  id: { type: 'string' as const },
  /**
   * Parent directory of `wiki/` (same as `BRAIN_WIKI_ROOT`). Overrides any existing env value for this process.
   */
  brainWikiRoot: { type: 'string' as const },
}

/** Apply parsed eval CLI flags (used by tests). */
export function applyEvalCliParsedValues(values: {
  provider?: boolean | string
  model?: boolean | string
  fastLlm?: boolean | string
  id?: boolean | string
  brainWikiRoot?: boolean | string
}): void {
  const p = typeof values.provider === 'string' && values.provider.trim() ? values.provider.trim() : undefined
  const m = typeof values.model === 'string' && values.model.trim() ? values.model.trim() : undefined
  const fast = typeof values.fastLlm === 'string' && values.fastLlm.trim() ? values.fastLlm.trim() : undefined

  if (p && m) {
    process.env.BRAIN_LLM = `${p}/${m}`
  } else if (m && !p) {
    process.env.BRAIN_LLM = m
  } else if (p && !m) {
    const def = getDefaultLlmModelForProvider(p)
    if (def) process.env.BRAIN_LLM = `${p}/${def}`
    else process.env.BRAIN_LLM = p
  }

  if (fast) {
    process.env.BRAIN_FAST_LLM = fast
  }

  if (typeof values.id === 'string' && values.id.trim()) {
    process.env.EVAL_CASE_ID = values.id.trim()
  }
  if (typeof values.brainWikiRoot === 'string' && values.brainWikiRoot.trim()) {
    process.env.BRAIN_WIKI_ROOT = resolve(values.brainWikiRoot.trim())
  }
}

/**
 * Load `./.env` from cwd, then apply CLI flags to `BRAIN_LLM` / `BRAIN_FAST_LLM`. Exits 0 on `--help`.
 */
export function loadEvalEnvAndLlmCli(helpText: string): void {
  loadDotEnv()
  const { values } = parseArgs({
    options: evalCliParseOptions,
    allowPositionals: true,
    strict: false,
  })

  if (values.help) {
    console.log(helpText)
    process.exit(0)
  }
  applyEvalCliParsedValues(values)
  const fromArgv = extractBrainWikiRootFromArgv(process.argv)
  if (fromArgv?.trim()) {
    process.env.BRAIN_WIKI_ROOT = resolve(fromArgv.trim())
  }
  applyEvalNewRelicDefaults()
}
