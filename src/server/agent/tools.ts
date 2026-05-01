import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { createWikiScopedPiTools, type WikiWriteCreatesPolicy } from './tools/wikiScopedFsTools.js'
import { createWikiFileManagementTools } from './tools/wikiFileManagementTools.js'
import { createRipmailAgentTools } from './tools/ripmailAgentTools.js'
import { createCalendarTool } from './tools/calendarTools.js'
import { createWebAgentTools } from './tools/webAgentTools.js'
import { createUiAgentTools } from './tools/uiAgentTools.js'
import { createLocalMessageTools } from './tools/localMessageTools.js'

export { normalizePhoneDigits, phoneToFlexibleGrepPattern } from '@server/lib/apple/imessagePhone.js'
export {
  buildRipmailSearchCommandLine,
  buildInboxRulesCommand,
  buildDraftEditFlags,
  buildSourcesAddGoogleDriveCommand,
  buildSourcesAddLocalDirCommand,
  buildSourcesEditCommand,
  buildSourcesRemoveCommand,
  buildReindexCommand,
  stripSearchIndexResult,
  stripReadEmailResult,
  selectSearchResultTier,
  selectInboxTier,
  applyInboxResolution,
} from './tools/ripmailCli.js'

export interface CreateAgentToolsOptions {
  /**
   * Include list_recent_messages / get_message_thread (local SMS/text + iMessage via macOS chat.db when readable).
   * Default: true only on macOS (Apple local integration env) with chat.db readable at startup.
   */
  includeLocalMessageTools?: boolean
  /** Tool `name`s to drop from the returned list (denylist). Ignored if `onlyToolNames` is set. */
  omitToolNames?: readonly string[]
  /**
   * If set, only these tools are included (allowlist). When present, `omitToolNames` is ignored.
   * See {@link buildCreateAgentToolsOptions} in `agentToolSets.ts` for presets.
   */
  onlyToolNames?: readonly string[]
  /** IANA timezone for calendar agent enrichment (e.g. from chat client). */
  timezone?: string
  /**
   * When `forbidden`, **`write`** rejects targets that do not already exist on disk (wiki buildout — OPP-067).
   * @default 'allowed'
   */
  wikiWriteCreates?: WikiWriteCreatesPolicy
  /**
   * When set, **`calendar`** tool only allows these `op` values (onboarding interview guardrail).
   */
  calendarAllowedOps?: readonly string[]
}

function resolveIncludeLocalMessageTools(options?: CreateAgentToolsOptions): boolean {
  if (options?.includeLocalMessageTools !== undefined) return options.includeLocalMessageTools
  return areLocalMessageToolsEnabled()
}

/**
 * Create all agent tools scoped to a wiki directory.
 * Pi-coding-agent provides file tools (read/edit/write/grep/find).
 * Custom tools handle ripmail, calendar, web APIs, onboarding-adjacent flows, etc.
 */
// Pi agent accepts this heterogeneous tool list; narrowing to ToolDefinition[] breaks AgentTool assignability downstream.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentTools(wikiDir: string, options?: CreateAgentToolsOptions): any[] {
  const includeLocalMessages = resolveIncludeLocalMessageTools(options)
  const agentTimeZone = options?.timezone?.trim() || 'UTC'
  const { read, edit, write, grep, find } = createWikiScopedPiTools(wikiDir, {
    wikiWriteCreates: options?.wikiWriteCreates ?? 'allowed',
  })

  const { moveFile, deleteFile } = createWikiFileManagementTools(wikiDir)

  const {
    searchIndex,
    readMailMessage,
    readIndexedFile,
    readAttachment,
    manageSources,
    refreshSources,
    listInbox,
    inboxRules,
    archiveEmails,
    draftEmail,
    editDraft,
    sendDraft,
    findPerson,
  } = createRipmailAgentTools(wikiDir)

  const { calendar } = createCalendarTool(agentTimeZone, {
    allowedOps: options?.calendarAllowedOps,
  })

  const { webSearch, fetchPage, getYoutubeTranscript, youtubeSearch } = createWebAgentTools()

  const {
    finishConversation,
    setChatTitle,
    openTool,
    speakTool,
    productFeedback,
    rememberPreference,
    loadSkill,
    suggestReplyOptions,
  } = createUiAgentTools(wikiDir)

  const { listRecentMessagesTool, getMessageThreadTool, searchMessagesTool } = createLocalMessageTools(wikiDir)

  const tools = [
    read,
    edit,
    write,
    grep,
    find,
    moveFile,
    deleteFile,
    searchIndex,
    readMailMessage,
    readIndexedFile,
    readAttachment,
    manageSources,
    refreshSources,
    listInbox,
    inboxRules,
    archiveEmails,
    draftEmail,
    editDraft,
    sendDraft,
    findPerson,
    calendar,
    webSearch,
    fetchPage,
    getYoutubeTranscript,
    youtubeSearch,
    finishConversation,
    setChatTitle,
    openTool,
    speakTool,
    productFeedback,
    rememberPreference,
    loadSkill,
    suggestReplyOptions,
    searchMessagesTool,
    ...(includeLocalMessages ? [listRecentMessagesTool, getMessageThreadTool] : []),
  ]
  const only = options?.onlyToolNames
  if (only?.length) {
    const allow = new Set(only)
    return tools.filter((t: { name?: string }) => t.name == null || allow.has(t.name))
  }
  const omit = options?.omitToolNames
  if (omit?.length) {
    const drop = new Set(omit)
    return tools.filter((t: { name?: string }) => t.name == null || !drop.has(t.name))
  }
  return tools
}
