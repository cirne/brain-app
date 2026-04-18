import type { Component } from 'svelte'
import { TOOL_ICONS } from './tools/registryIcons.js'

export function getToolIcon(toolName: string): Component | null {
  return TOOL_ICONS[toolName] ?? null
}
