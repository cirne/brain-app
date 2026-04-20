import { describe, it, expect } from 'vitest'
import {
  appendTimelineEvent,
  MAX_TIMELINE_EVENTS,
  type BackgroundRunDoc,
  type BackgroundTimelineEvent,
} from './backgroundAgentStore.js'

function baseDoc(): BackgroundRunDoc {
  const now = new Date().toISOString()
  return {
    id: 'your-wiki',
    kind: 'your-wiki',
    status: 'running',
    label: 'Your Wiki',
    detail: '',
    pageCount: 0,
    logLines: [],
    startedAt: now,
    updatedAt: now,
    timeline: [],
  }
}

function toolEvent(i: number): BackgroundTimelineEvent {
  return {
    at: `2026-01-01T12:00:00.${String(i).padStart(3, '0')}Z`,
    kind: 'tool',
    toolName: 'write',
  }
}

describe('appendTimelineEvent', () => {
  it('keeps only the last MAX_TIMELINE_EVENTS entries', () => {
    const doc = baseDoc()
    const over = 7
    for (let i = 0; i < MAX_TIMELINE_EVENTS + over; i++) {
      appendTimelineEvent(doc, toolEvent(i))
    }
    expect(doc.timeline?.length).toBe(MAX_TIMELINE_EVENTS)
    expect(doc.timeline?.[0]?.at).toBe(toolEvent(over).at)
    expect(doc.timeline?.at(-1)?.at).toBe(toolEvent(MAX_TIMELINE_EVENTS + over - 1).at)
  })
})
