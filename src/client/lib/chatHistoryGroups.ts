export type ChatHistoryGroupKey = 'today' | 'yesterday' | 'week' | 'month' | 'older'

export const CHAT_HISTORY_GROUP_ORDER: ChatHistoryGroupKey[] = [
  'today',
  'yesterday',
  'week',
  'month',
  'older',
]

export const CHAT_HISTORY_GROUP_LABEL: Record<ChatHistoryGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Previous 7 days',
  month: 'Previous 30 days',
  older: 'Older',
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Group sessions by `updatedAt` into relative date buckets (local calendar days). */
export function groupKeyForUpdatedAt(iso: string, now = new Date()): ChatHistoryGroupKey {
  const d = new Date(iso)
  const sod = startOfDay(now)
  const dayMs = 86400000
  const diffDays = Math.floor((sod.getTime() - startOfDay(d).getTime()) / dayMs)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays <= 7) return 'week'
  if (diffDays <= 30) return 'month'
  return 'older'
}
