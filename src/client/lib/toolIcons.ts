import {
  FileText,
  Pencil,
  FilePlus,
  Search,
  FolderSearch,
  Mail,
  MailSearch,
  Send,
  UserSearch,
  BookOpen,
  Calendar,
  Globe,
  Play,
  PanelRightOpen,
  MessageSquare,
} from 'lucide-svelte'
import type { Component } from 'svelte'

/* Lucide icon components are structurally compatible; Svelte 5 `Component` is stricter than lucide-svelte exports. */
const TOOL_ICONS = {
  read: FileText,
  edit: Pencil,
  write: FilePlus,
  grep: Search,
  find: FolderSearch,
  search_email: MailSearch,
  read_email: Mail,
  draft_email: Pencil,
  edit_draft: Pencil,
  send_draft: Send,
  find_person: UserSearch,
  get_calendar_events: Calendar,
  web_search: Globe,
  fetch_page: Globe,
  get_youtube_transcript: Play,
  youtube_search: Play,
  open: PanelRightOpen,
  list_recent_messages: MessageSquare,
  get_message_thread: MessageSquare,
  /** @deprecated persisted sessions */
  list_imessage_recent: MessageSquare,
  /** @deprecated persisted sessions */
  get_imessage_thread: MessageSquare,
} as unknown as Record<string, Component>

export function getToolIcon(toolName: string): Component | null {
  return TOOL_ICONS[toolName] ?? null
}
