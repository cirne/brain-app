import { vi } from 'vitest'

import type { SkillMenuItem } from '@client/lib/agentUtils.js'

/** One real skill shape for composer tests; extend or override per test. */
export const testSkillSummarize: SkillMenuItem = {
  slug: 'summarize',
  name: 'summarize',
  label: 'Summarize',
  description: 'd',
}

/** Defaults for {@link AgentInput}; pass overrides (e.g. `wikiFiles`, `streaming`, `onStop`). */
export function agentInputTestProps(
  overrides: Partial<{
    onSend: (text: string) => void
    onStop: () => void
    onNewChat: () => void
    wikiFiles: string[]
    skills: SkillMenuItem[]
    disabled: boolean
    streaming: boolean
  }> = {},
): {
  onSend: (text: string) => void
  onStop?: () => void
  onNewChat?: () => void
  wikiFiles: string[]
  skills: SkillMenuItem[]
  disabled?: boolean
  streaming?: boolean
} {
  return {
    onSend: vi.fn() as (text: string) => void,
    wikiFiles: [] as string[],
    skills: [testSkillSummarize],
    ...overrides,
  }
}

/** Minimal props for {@link ChatHistory}; both callbacks default to `vi.fn()`. */
export function chatHistoryTestProps(
  overrides: Partial<{
    onSelect: (id: string) => void
    onNewChat: () => void
  }> = {},
) {
  return {
    onSelect: vi.fn() as (id: string) => void,
    onNewChat: vi.fn() as () => void,
    ...overrides,
  }
}
