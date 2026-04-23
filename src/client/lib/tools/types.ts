import type { Component } from 'svelte'
import type { ContentCardPreview } from '../cards/contentCardShared.js'
import type { ToolCall } from '../agentUtils.js'

/** Chat/stream policy (replaces sparse `TOOL_UI_POLICIES`); default shows tools in transcript. */
export type ToolChatPolicy = {
  showInChat: boolean
  streamToDetail?: 'wiki' | 'email' | 'calendar'
  autoOpen?: boolean
  label?: string
}

export type OnboardingVariant = 'profiling' | 'buildout'

/** Rich mail row for read_email progress (same shape as ProfilingEmailRef). */
export type SeedingMailPreview = {
  id: string
  subject: string
  from: string
  snippet: string
}

/** One row in the wiki seeding onboarding checklist. */
export type SeedingProgressLine = {
  id: string
  kind: 'done' | 'active-tool' | 'planning'
  prefix: string
  path?: string
  detail?: string
  /** read_email email: show Mail referenced–style card at this step. */
  mailPreview?: SeedingMailPreview
}

/** One tool step in seed order (done vs in-flight). */
export type SeedingProgressUiRow = {
  done: boolean
  line: SeedingProgressLine
}

/**
 * Single client-side definition for a tool: chat policy, icon, optional rich preview,
 * and optional onboarding copy / seeding checklist rows.
 */
export type ToolDefinition = {
  chat: ToolChatPolicy
  icon: Component | null
  /** Rich card preview for completed tool calls (transcript + resource extraction). */
  matchPreview?: (tc: ToolCall) => ContentCardPreview | null
  /**
   * Shown while this tool is in flight (onboarding activity strip).
   * When absent, callers fall back to `Running {name}…` / generic text.
   */
  onboardingActivityInFlight?: Partial<Record<OnboardingVariant, string>>
  /**
   * Wiki buildout progress list (done vs active). When absent, generic fallback.
   */
  seedingProgressLine?: (phase: 'done' | 'active', tc: ToolCall) => SeedingProgressLine | null
}
