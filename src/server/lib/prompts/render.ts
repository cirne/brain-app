import Handlebars from 'handlebars'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDevRuntime } from '@server/lib/platform/isDevRuntime.js'
import { getPromptsRoot } from './registry.js'

const instance = Handlebars.create()
const compileCache = new Map<string, Handlebars.TemplateDelegate>()

export function readPromptFile(relPath: string): string {
  const full = join(getPromptsRoot(), relPath)
  return readFileSync(full, 'utf-8')
}

/**
 * Renders a `.hbs` file under the prompts root. Templates use default HTML escaping;
 * pass `Handlebars.SafeString` (or triple-mustache in the file) for trusted raw blocks.
 */
const isDev = isDevRuntime()

export function renderPromptTemplate(relPath: string, context: Record<string, unknown>): string {
  const full = join(getPromptsRoot(), relPath)
  const source = readFileSync(full, 'utf-8')
  if (isDev) {
    return instance.compile(source, { strict: false })(context)
  }
  let fn = compileCache.get(full)
  if (!fn) {
    fn = instance.compile(source, { strict: false })
    compileCache.set(full, fn)
  }
  return fn(context)
}
