/**
 * Shared `.env` load + `--provider` / `--model` / `--help` for eval CLIs (same as dev server env).
 */
import { parseArgs } from 'node:util'
import { loadDotEnv } from '@server/lib/platform/loadDotEnv.js'

const options = {
  provider: { type: 'string' as const, short: 'p' as const },
  model: { type: 'string' as const, short: 'm' as const },
  help: { type: 'boolean' as const, short: 'h' as const },
}

/**
 * Load `./.env` from cwd, then apply CLI flags to `LLM_PROVIDER` / `LLM_MODEL`. Exits 0 on `--help`.
 */
export function loadEvalEnvAndLlmCli(helpText: string): void {
  loadDotEnv()
  const { values } = parseArgs({
    options,
    allowPositionals: true,
    strict: false,
  })

  if (values.help) {
    console.log(helpText)
    process.exit(0)
  }
  if (typeof values.provider === 'string' && values.provider.trim()) {
    process.env.LLM_PROVIDER = values.provider.trim()
  }
  if (typeof values.model === 'string' && values.model.trim()) {
    process.env.LLM_MODEL = values.model.trim()
  }
}
