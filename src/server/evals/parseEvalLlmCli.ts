/**
 * Shared `.env` load + `--provider` / `--model` / `--help` for eval CLIs (same as dev server env).
 */
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { loadDotEnv } from '@server/lib/platform/loadDotEnv.js'

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
  id?: boolean | string
  brainWikiRoot?: boolean | string
}): void {
  if (typeof values.provider === 'string' && values.provider.trim()) {
    process.env.LLM_PROVIDER = values.provider.trim()
  }
  if (typeof values.model === 'string' && values.model.trim()) {
    process.env.LLM_MODEL = values.model.trim()
  }
  if (typeof values.id === 'string' && values.id.trim()) {
    process.env.EVAL_CASE_ID = values.id.trim()
  }
  if (typeof values.brainWikiRoot === 'string' && values.brainWikiRoot.trim()) {
    process.env.BRAIN_WIKI_ROOT = resolve(values.brainWikiRoot.trim())
  }
}

/**
 * Load `./.env` from cwd, then apply CLI flags to `LLM_PROVIDER` / `LLM_MODEL`. Exits 0 on `--help`.
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
}
