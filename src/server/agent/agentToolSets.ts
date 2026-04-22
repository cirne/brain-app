import type { CreateAgentToolsOptions } from './tools.js'

/**
 * Every tool name registered by `createAgentTools` when **all** optional tools are included
 * (`includeLocalMessageTools: true`). Used for allowlists and preset diffs.
 *
 * Pi-coding-agent file tools (`read`, `grep`, `find`) have no `name:` in this file — names match pi-coding-agent.
 */
export const ALL_AGENT_TOOL_NAMES = [
  'read',
  'edit',
  'write',
  'grep',
  'find',
  'move_file',
  'delete_file',
  'search_index',
  'read_doc',
  'manage_sources',
  'list_inbox',
  'inbox_rules',
  'archive_emails',
  'draft_email',
  'edit_draft',
  'send_draft',
  'find_person',
  'calendar',
  'web_search',
  'fetch_page',
  'get_youtube_transcript',
  'youtube_search',
  'set_chat_title',
  'open',
  'remember_preference',
  'list_recent_messages',
  'get_message_thread',
] as const

export type AgentToolName = (typeof ALL_AGENT_TOOL_NAMES)[number]

/** Grouped names for composing custom omit/only lists (subset of {@link ALL_AGENT_TOOL_NAMES}). */
export const TOOL_GROUPS = {
  wikiFilesystem: ['read', 'grep', 'find', 'move_file', 'delete_file'] as const satisfies readonly AgentToolName[],
  wikiWrite: ['edit', 'write', 'remember_preference'] as const satisfies readonly AgentToolName[],
  filesSources: ['manage_sources'] as const satisfies readonly AgentToolName[],
  mailCore: ['search_index', 'read_doc', 'list_inbox', 'find_person'] as const satisfies readonly AgentToolName[],
  mailHeavy: ['inbox_rules', 'archive_emails', 'draft_email', 'edit_draft', 'send_draft'] as const satisfies readonly AgentToolName[],
  calendar: ['calendar'] as const satisfies readonly AgentToolName[],
  web: ['web_search', 'fetch_page'] as const satisfies readonly AgentToolName[],
  youtube: ['get_youtube_transcript', 'youtube_search'] as const satisfies readonly AgentToolName[],
  ui: ['set_chat_title', 'open'] as const satisfies readonly AgentToolName[],
  localMessages: ['list_recent_messages', 'get_message_thread'] as const satisfies readonly AgentToolName[],
} as const

/** Base omit list shared by onboarding profiling + seeding (mail + write/edit; no wiki read, no heavy mail, no sources). */
export const ONBOARDING_BASE_OMIT: readonly AgentToolName[] = [
  'read',
  'grep',
  'find',
  'inbox_rules',
  'archive_emails',
  'draft_email',
  'edit_draft',
  'send_draft',
  'calendar',
  'get_youtube_transcript',
  'open',
  'list_recent_messages',
  'get_message_thread',
  'manage_sources',
]

/**
 * Onboarding **buildout** omit list: same as {@link ONBOARDING_BASE_OMIT} but keeps
 * `list_recent_messages` / `get_message_thread` when `includeLocalMessageTools` is true in `createAgentTools`.
 */
export const ONBOARDING_BUILDOUT_OMIT: readonly AgentToolName[] = ONBOARDING_BASE_OMIT.filter(
  (n) => n !== 'list_recent_messages' && n !== 'get_message_thread',
)

/** Profiling agent: omit web/video on top of onboarding base (indexed mail only); no chat title (UI shows fixed onboarding copy). */
export const ONBOARDING_PROFILING_EXTRA_OMIT: readonly AgentToolName[] = [
  'web_search',
  'fetch_page',
  'youtube_search',
  'set_chat_title',
]

/**
 * Wiki cleanup / lint agent: keeps `read`, `grep`, `find`, `edit` and mail/web lookup tools,
 * but omits `write` (no new pages), destructive file ops, heavy mail actions, and UI tools.
 */
export const WIKI_CLEANUP_OMIT: readonly AgentToolName[] = [
  'write',
  'move_file',
  'delete_file',
  'inbox_rules',
  'archive_emails',
  'draft_email',
  'edit_draft',
  'send_draft',
  'calendar',
  'get_youtube_transcript',
  'youtube_search',
  'open',
  'set_chat_title',
  'remember_preference',
  'list_recent_messages',
  'get_message_thread',
  'manage_sources',
]

/**
 * Merge several omit lists (e.g. presets + ad-hoc). Order does not matter; duplicates are removed.
 */
export function mergeOmitToolNames(...lists: readonly (readonly string[])[]): readonly string[] {
  const out: string[] = []
  for (const list of lists) {
    for (const x of list) {
      if (x && !out.includes(x)) out.push(x)
    }
  }
  return out
}

export type OnboardingAgentToolVariant = 'buildout' | 'profiling'

function omitForOnboardingVariant(variant: OnboardingAgentToolVariant): readonly string[] {
  if (variant === 'profiling') {
    return mergeOmitToolNames(ONBOARDING_BASE_OMIT, ONBOARDING_PROFILING_EXTRA_OMIT)
  }
  return [...ONBOARDING_BUILDOUT_OMIT]
}

/**
 * Build {@link CreateAgentToolsOptions} for agents that use named presets and optional extra omits.
 *
 * - **`onlyToolNames`** (if set) is an allowlist; `omitToolNames` from presets are ignored unless you omit `only`.
 * - When `onlyToolNames` is unset, preset + `extraOmit` are merged into `omitToolNames`.
 */
export function buildCreateAgentToolsOptions(args: {
  /** Preset omit lists; default is full assistant (no preset omit). */
  preset?: 'assistant' | 'onboarding'
  /** When `preset` is `onboarding`, narrow profiling vs buildout (extra omit for profiling). */
  onboardingVariant?: OnboardingAgentToolVariant
  includeLocalMessageTools?: boolean
  /** Additional tool names to drop (merged with preset omit). Ignored if `onlyToolNames` is set. */
  extraOmit?: readonly string[]
  /** If set, only these tools are kept (allowlist). See `createAgentTools` in tools.ts. */
  onlyToolNames?: readonly string[]
}): CreateAgentToolsOptions {
  const {
    preset = 'assistant',
    onboardingVariant = 'buildout',
    includeLocalMessageTools,
    extraOmit = [],
    onlyToolNames,
  } = args

  if (onlyToolNames?.length) {
    return {
      includeLocalMessageTools,
      onlyToolNames,
    }
  }

  let omit: readonly string[] = []
  if (preset === 'onboarding') {
    omit = mergeOmitToolNames(omitForOnboardingVariant(onboardingVariant), extraOmit)
  } else if (extraOmit.length) {
    omit = mergeOmitToolNames(extraOmit)
  }

  return {
    includeLocalMessageTools,
    ...(omit.length ? { omitToolNames: omit } : {}),
  }
}
