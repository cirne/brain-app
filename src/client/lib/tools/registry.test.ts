import { describe, expect, it } from 'vitest'
import { getToolDefinitionCore } from './registryCore.js'

/** Mirrors `ALL_AGENT_TOOL_NAMES` in `src/server/agent/agentToolSets.ts` (keep in sync). */
const ALL_AGENT_TOOL_NAMES = [
  'read',
  'edit',
  'write',
  'grep',
  'find',
  'move_file',
  'delete_file',
  'search_index',
  'read_doc',
  'list_sources',
  'source_status',
  'add_files_source',
  'edit_files_source',
  'remove_files_source',
  'reindex_files_source',
  'list_inbox',
  'inbox_rules',
  'archive_emails',
  'draft_email',
  'edit_draft',
  'send_draft',
  'find_person',
  'get_calendar_events',
  'web_search',
  'fetch_page',
  'get_youtube_transcript',
  'youtube_search',
  'set_chat_title',
  'open',
  'list_recent_messages',
  'get_message_thread',
] as const

describe('getToolDefinitionCore', () => {
  it('returns chat policy and handlers for every server tool name', () => {
    for (const name of ALL_AGENT_TOOL_NAMES) {
      const d = getToolDefinitionCore(name)
      expect(d.chat).toBeDefined()
      expect(typeof d.chat.showInChat).toBe('boolean')
      expect(d.matchPreview).toBeDefined()
      expect(d.seedingProgressLine).toBeDefined()
    }
  })

  it('hides set_chat_title from transcript', () => {
    expect(getToolDefinitionCore('set_chat_title').chat.showInChat).toBe(false)
  })
})
