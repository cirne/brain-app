/**
 * Icon-free tool UI registry (chat, previews, onboarding). Safe to import from Node tests
 * without loading `lucide-svelte`. Icons: {@link registryIcons.TOOL_ICONS} or {@link getToolDefinition}.
 */
import type { ToolCall } from '../agentUtils.js'
import { get } from 'svelte/store'
import { t } from '@client/lib/i18n/index.js'
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
const TOOL_DISPLAY_LABELS: Record<string, { key: string; defaultValue: string }> = {
  read: { key: 'read', defaultValue: 'Read file' },
  edit: { key: 'edit', defaultValue: 'Edit file' },
  write: { key: 'write', defaultValue: 'Write file' },
  grep: { key: 'grep', defaultValue: 'Search in wiki' },
  find: { key: 'find', defaultValue: 'Find wiki files (glob)' },
  move_file: { key: 'moveFile', defaultValue: 'Move file' },
  delete_file: { key: 'deleteFile', defaultValue: 'Delete file' },
  rmdir: { key: 'rmdir', defaultValue: 'Remove folder' },
  search_index: { key: 'searchIndex', defaultValue: 'Search index' },
  read_mail_message: { key: 'readMailMessage', defaultValue: 'Read mail' },
  read_indexed_file: { key: 'readIndexedFile', defaultValue: 'Read file' },
  read_attachment: { key: 'readAttachment', defaultValue: 'Read attachment' },
  manage_sources: { key: 'manageSources', defaultValue: 'Manage sources' },
  refresh_sources: { key: 'refreshSources', defaultValue: 'Sync sources' },
  list_inbox: { key: 'listInbox', defaultValue: 'Inbox' },
  inbox_rules: { key: 'inboxRules', defaultValue: 'Inbox rules' },
  archive_emails: { key: 'archiveEmails', defaultValue: 'Archive mail' },
  draft_email: { key: 'draftEmail', defaultValue: 'Draft email' },
  edit_draft: { key: 'editDraft', defaultValue: 'Edit draft' },
  delete_draft: { key: 'deleteDraft', defaultValue: 'Delete draft' },
  send_draft: { key: 'sendDraft', defaultValue: 'Send mail' },
  ask_collaborator: { key: 'askCollaborator', defaultValue: 'Ask Brain' },
  find_person: { key: 'findPerson', defaultValue: 'Find contact' },
  calendar: { key: 'calendar', defaultValue: 'Calendar' },
  web_search: { key: 'webSearch', defaultValue: 'Web search' },
  fetch_page: { key: 'fetchPage', defaultValue: 'Fetch page' },
  get_youtube_transcript: { key: 'youtubeTranscript', defaultValue: 'YouTube transcript' },
  youtube_search: { key: 'youtubeSearch', defaultValue: 'YouTube search' },
  finish_conversation: { key: 'finishConversation', defaultValue: 'Finish chat' },
  set_chat_title: { key: 'setChatTitle', defaultValue: 'Chat title' },
  speak: { key: 'speak', defaultValue: 'Read aloud' },
  open: { key: 'open', defaultValue: 'Open' },
  remember_preference: { key: 'rememberPreference', defaultValue: 'Remember preference' },
  load_skill: { key: 'loadSkill', defaultValue: 'Load skill' },
  list_recent_messages: { key: 'listRecentMessages', defaultValue: 'Recent messages' },
  get_message_thread: { key: 'getMessageThread', defaultValue: 'Conversation' },
  suggest_reply_options: { key: 'suggestReplyOptions', defaultValue: 'Quick Replies' },
  mark_notification: { key: 'markNotification', defaultValue: 'Notification done' },
  present_visual_artifact: { key: 'presentVisualArtifact', defaultValue: 'Show image' },
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
    chat: { autoOpen: true, stickyInTranscript: true },
  },
  present_visual_artifact: {
    chat: { stickyInTranscript: true },
  },
}

/** Resolve merged UI definition without icons (Node/test safe). */
export function getToolDefinitionCore(name: string): ToolDefinition {
  const partial = TOOL_REGISTRY[name]
  const def = partial ? mergeDefinition(partial) : DEFAULT_DEFINITION
  const label =
    def.chat.label ??
    (TOOL_DISPLAY_LABELS[name]
      ? get(t)(`chat.toolLabels.${TOOL_DISPLAY_LABELS[name].key}`, TOOL_DISPLAY_LABELS[name].defaultValue)
      : humanizeToolName(name))
  return {
    ...def,
    chat: { ...def.chat, label },
  }
}
