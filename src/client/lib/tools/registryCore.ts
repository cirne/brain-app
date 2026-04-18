/**
 * Icon-free tool UI registry (chat, previews, onboarding). Safe to import from Node tests
 * without loading `lucide-svelte`. Icons: {@link registryIcons.TOOL_ICONS} or {@link getToolDefinition}.
 */
import type { ToolCall } from '../agentUtils.js'
import { matchContentPreview } from './matchPreview.js'
import { buildSeedingLine } from './seedProgress.js'
import type { OnboardingVariant, ToolChatPolicy, ToolDefinition } from './types.js'

const DEFAULT_CHAT: ToolChatPolicy = {
  showInChat: true,
}

const DEFAULT_DEFINITION: ToolDefinition = {
  chat: DEFAULT_CHAT,
  icon: null,
  matchPreview: (tc: ToolCall) => matchContentPreview(tc),
  onboardingActivityInFlight: undefined,
  seedingProgressLine: (phase, tc) => buildSeedingLine(phase, tc, matchContentPreview),
}

type ToolRegistryPatch = Partial<
  Omit<ToolDefinition, 'icon' | 'chat'> & { chat?: Partial<ToolChatPolicy> }
>

function mergeChat(base: ToolChatPolicy, patch?: Partial<ToolChatPolicy>): ToolChatPolicy {
  if (!patch) return base
  return { ...base, ...patch }
}

function mergeDefinition(partial: ToolRegistryPatch): ToolDefinition {
  return {
    chat: mergeChat(DEFAULT_CHAT, partial.chat),
    icon: null,
    matchPreview: partial.matchPreview ?? DEFAULT_DEFINITION.matchPreview,
    onboardingActivityInFlight: partial.onboardingActivityInFlight ?? DEFAULT_DEFINITION.onboardingActivityInFlight,
    seedingProgressLine: partial.seedingProgressLine ?? DEFAULT_DEFINITION.seedingProgressLine,
  }
}

const ONBOARDING_ACTIVITY = {
  find_person: { profiling: 'Learning who you email…', seeding: 'Learning who you email…' },
  search_index: { profiling: 'Searching mail…', seeding: 'Searching mail…' },
  read_doc: { profiling: 'Reading a message…', seeding: 'Reading a message…' },
  write: { profiling: 'Writing your profile…', seeding: 'Writing a page…' },
  edit: { profiling: 'Updating your profile…', seeding: 'Updating a page…' },
  list_inbox: { profiling: 'Scanning inbox…', seeding: 'Scanning inbox…' },
  web_search: { profiling: 'Looking up the web…', seeding: 'Looking up the web…' },
  fetch_page: { profiling: 'Reading a web page…', seeding: 'Reading a web page…' },
  youtube_search: { profiling: 'Searching video…', seeding: 'Searching video…' },
} as const satisfies Record<string, Record<OnboardingVariant, string>>

/** Per-tool overrides (no icons — see `registryIcons.ts`). */
const TOOL_REGISTRY: Record<string, ToolRegistryPatch> = {
  edit: {
    chat: { streamToDetail: 'wiki', autoOpen: true, label: 'Editing file' },
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.edit,
  },
  write: {
    chat: { streamToDetail: 'wiki', autoOpen: true, label: 'Writing file' },
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.write,
  },
  search_index: {
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.search_index,
  },
  read_doc: {
    chat: { autoOpen: true, label: 'Reading' },
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.read_doc,
  },
  list_inbox: {
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.list_inbox,
  },
  find_person: {
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.find_person,
  },
  web_search: {
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.web_search,
  },
  fetch_page: {
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.fetch_page,
  },
  youtube_search: {
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.youtube_search,
  },
  set_chat_title: {
    chat: { showInChat: false },
  },
  open: {
    chat: { autoOpen: true, label: 'Opening' },
  },
}

/** Resolve merged UI definition without icons (Node/test safe). */
export function getToolDefinitionCore(name: string): ToolDefinition {
  const partial = TOOL_REGISTRY[name]
  if (!partial) return DEFAULT_DEFINITION
  return mergeDefinition(partial)
}
