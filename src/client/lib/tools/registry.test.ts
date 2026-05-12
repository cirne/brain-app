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
  'rmdir',
  'search_index',
  'read_mail_message',
  'read_indexed_file',
  'read_attachment',
  'manage_sources',
  'refresh_sources',
  'list_inbox',
  'inbox_rules',
  'archive_emails',
  'draft_email',
  'edit_draft',
  'delete_draft',
  'send_draft',
  'ask_collaborator',
  'find_person',
  'calendar',
  'web_search',
  'fetch_page',
  'get_youtube_transcript',
  'youtube_search',
  'finish_conversation',
  'set_chat_title',
  'open',
  'speak',
  'remember_preference',
  'load_skill',
  'list_recent_messages',
  'get_message_thread',
  'suggest_reply_options',
  'mark_notification',
] as const

describe('getToolDefinitionCore', () => {
  it('returns chat policy and handlers for every server tool name', () => {
    for (const name of ALL_AGENT_TOOL_NAMES) {
      const d = getToolDefinitionCore(name)
      expect(d.chat).toBeDefined()
      expect(typeof d.chat.showInChat).toBe('boolean')
      expect(typeof d.chat.label).toBe('string')
      expect(d.chat.label?.length).toBeGreaterThan(0)
      expect(d.chat.label).not.toMatch(/^[a-z]+(?:_[a-z]+)+$/)
      expect(d.matchPreview).toBeDefined()
      expect(d.seedingProgressLine).toBeDefined()
    }
  })

  it('hides set_chat_title from transcript', () => {
    expect(getToolDefinitionCore('set_chat_title').chat.showInChat).toBe(false)
  })

  it('hides finish_conversation from transcript', () => {
    expect(getToolDefinitionCore('finish_conversation').chat.showInChat).toBe(false)
  })

  it('hides speak from transcript', () => {
    expect(getToolDefinitionCore('speak').chat.showInChat).toBe(false)
  })

  it('hides suggest_reply_options from transcript', () => {
    expect(getToolDefinitionCore('suggest_reply_options').chat.showInChat).toBe(false)
  })

  it('shows mark_notification in transcript', () => {
    const d = getToolDefinitionCore('mark_notification')
    expect(d.chat.showInChat).toBe(true)
    expect(d.chat.label).toContain('Notification')
  })
})
