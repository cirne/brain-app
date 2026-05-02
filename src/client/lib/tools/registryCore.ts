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

/** Present-tense labels for the chat / activity tool summary line (not snake_case). */
const TOOL_DISPLAY_LABELS: Record<string, string> = {
  read: 'Read file',
  edit: 'Edit file',
  write: 'Write file',
  grep: 'Search in wiki',
  find: 'Find wiki file',
  move_file: 'Move file',
  delete_file: 'Delete file',
  search_index: 'Search index',
  read_mail_message: 'Read mail',
  read_indexed_file: 'Read file',
  read_attachment: 'Read attachment',
  manage_sources: 'Manage sources',
  refresh_sources: 'Sync sources',
  list_inbox: 'Inbox',
  inbox_rules: 'Inbox rules',
  archive_emails: 'Archive mail',
  draft_email: 'Draft email',
  edit_draft: 'Edit draft',
  send_draft: 'Send mail',
  find_person: 'Find contact',
  calendar: 'Calendar',
  web_search: 'Web search',
  fetch_page: 'Fetch page',
  get_youtube_transcript: 'YouTube transcript',
  youtube_search: 'YouTube search',
  finish_conversation: 'Finish chat',
  set_chat_title: 'Chat title',
  speak: 'Read aloud',
  open: 'Open',
  remember_preference: 'Remember preference',
  load_skill: 'Load skill',
  list_recent_messages: 'Recent messages',
  get_message_thread: 'Conversation',
  suggest_reply_options: 'Quick Replies',
}

function humanizeToolName(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

const ONBOARDING_ACTIVITY = {
  find_person: { profiling: 'Learning who you email…', buildout: 'Learning who you email…' },
  search_index: { profiling: 'Searching index…', buildout: 'Searching index…' },
  read_mail_message: { profiling: 'Reading mail…', buildout: 'Reading mail…' },
  read_indexed_file: { profiling: 'Reading file…', buildout: 'Reading file…' },
  write: { profiling: 'Writing your profile…', buildout: 'Writing a page…' },
  edit: { profiling: 'Updating your profile…', buildout: 'Updating a page…' },
  list_inbox: { profiling: 'Scanning inbox…', buildout: 'Scanning inbox…' },
  web_search: { profiling: 'Looking up the web…', buildout: 'Looking up the web…' },
  fetch_page: { profiling: 'Reading a web page…', buildout: 'Reading a web page…' },
  youtube_search: { profiling: 'Searching video…', buildout: 'Searching video…' },
} as const satisfies Record<string, Record<OnboardingVariant, string>>

/** Per-tool overrides (no icons — see `registryIcons.ts`). */
const TOOL_REGISTRY: Record<string, ToolRegistryPatch> = {
  edit: {
    chat: { streamToDetail: 'wiki', autoOpen: true },
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.edit,
  },
  write: {
    chat: { streamToDetail: 'wiki', autoOpen: true },
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.write,
  },
  search_index: {
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.search_index,
  },
  read_mail_message: {
    /** Mail stays as in-chat preview; user opens the panel via the tool card / explicit `open`. */
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.read_mail_message,
  },
  read_indexed_file: {
    /** Indexed/path reads stay as in-chat preview; user opens the panel via the tool card / explicit `open`. */
    onboardingActivityInFlight: ONBOARDING_ACTIVITY.read_indexed_file,
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
  finish_conversation: {
    chat: { showInChat: false },
  },
  set_chat_title: {
    chat: { showInChat: false },
  },
  speak: {
    chat: { showInChat: false },
  },
  suggest_reply_options: {
    chat: { showInChat: false },
  },
  open: {
    chat: { autoOpen: true },
  },
}

/** Resolve merged UI definition without icons (Node/test safe). */
export function getToolDefinitionCore(name: string): ToolDefinition {
  const partial = TOOL_REGISTRY[name]
  const def = partial ? mergeDefinition(partial) : DEFAULT_DEFINITION
  const label = def.chat.label ?? TOOL_DISPLAY_LABELS[name] ?? humanizeToolName(name)
  return {
    ...def,
    chat: { ...def.chat, label },
  }
}
