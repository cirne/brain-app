/**
 * Full tool UI definition including Lucide icon. Prefer {@link getToolDefinitionCore} in Node tests.
 */
import type { ToolDefinition } from './types.js'
import { getToolDefinitionCore } from './registryCore.js'
import { TOOL_ICONS } from './registryIcons.js'

export { getToolDefinitionCore } from './registryCore.js'

/** Merged UI definition with icon for browser / Svelte. */
export function getToolDefinition(name: string): ToolDefinition {
  const base = getToolDefinitionCore(name)
  return { ...base, icon: TOOL_ICONS[name] ?? null }
}
