import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyEvalNewRelicDefaults } from '@server/evals/parseEvalLlmCli.js'
import { setPromptsRoot } from '@server/lib/prompts/registry.js'

applyEvalNewRelicDefaults()

const here = dirname(fileURLToPath(import.meta.url))
setPromptsRoot(join(here, '../prompts'))
