import {
  FileText,
  Pencil,
  FilePlus,
  Search,
  FolderSearch,
  Mail,
  MailSearch,
  Send,
  GitCommitVertical,
  UserSearch,
  BookOpen,
  Calendar,
  Globe,
  Play,
} from 'lucide-svelte'
import type { Component } from 'svelte'

const TOOL_ICONS: Record<string, Component> = {
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
  git_commit_push: GitCommitVertical,
  find_person: UserSearch,
  wiki_log: BookOpen,
  get_calendar_events: Calendar,
  web_search: Globe,
  fetch_page: Globe,
  get_youtube_transcript: Play,
  youtube_search: Play,
}

export function getToolIcon(toolName: string): Component | null {
  return TOOL_ICONS[toolName] ?? null
}
