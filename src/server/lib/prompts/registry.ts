import { existsSync } from 'node:fs'
import { join } from 'node:path'

let promptsRoot: string | null = null

function tryDefaultPromptsDirFromCwd(): string | null {
  const a = join(process.cwd(), 'src/server/prompts')
  const b = join(process.cwd(), 'dist/server/prompts')
  if (existsSync(a)) return a
  if (existsSync(b)) return b
  return null
}

/** Called from server entry (`index`, `sync-cli`) so `dist/server/prompts` resolves next to the bundle. */
export function setPromptsRoot(dir: string): void {
  promptsRoot = dir
}

/** Idempotent: set only if not already set (eval harness, tests). */
export function ensurePromptsRoot(dir: string): void {
  if (promptsRoot === null) promptsRoot = dir
}

export function getPromptsRoot(): string {
  if (promptsRoot === null) {
    const d = tryDefaultPromptsDirFromCwd()
    if (d) promptsRoot = d
  }
  if (promptsRoot === null) {
    throw new Error('Prompts root not set — call setPromptsRoot from server entry or ensurePromptsRoot from tests/eval')
  }
  return promptsRoot
}
