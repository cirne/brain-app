import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setPromptsRoot } from '@server/lib/prompts/registry.js'

const here = dirname(fileURLToPath(import.meta.url))
setPromptsRoot(join(here, '../prompts'))
