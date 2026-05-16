import { AlignCenter, AlignLeft, AlignRight, Type } from '@lucide/svelte'
import type { Component } from 'svelte'

/** One segment in {@link SegmentedControl}. */
export type SegmentedOption<T = string> = {
  value: T
  label: string
  /** Key in {@link SEGMENTED_CONTROL_ICONS}; extend the map for new ids. */
  icon?: string
  /** Icon box size in px (stroke Lucide). Default 14. */
  iconSize?: number
  /** `data-testid` on the segment button. */
  testId?: string
  disabled?: boolean
}

/**
 * Built-in Lucide icons for segmented controls. Import components from `@lucide/svelte`
 * and add entries when you need new ids.
 */
export const SEGMENTED_CONTROL_ICONS = {
  type: Type,
  'align-left': AlignLeft,
  'align-center': AlignCenter,
  'align-right': AlignRight,
} as unknown as Record<string, Component>

export function getSegmentedControlIcon(
  id: string | undefined,
): Component | null {
  if (!id) return null
  const Icon = SEGMENTED_CONTROL_ICONS[id]
  return Icon ?? null
}
