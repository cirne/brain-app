import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { getCalendarEventsFromRipmail } from '../lib/calendarRipmail.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'

vi.mock('../lib/calendarRipmail.js', () => ({
  getCalendarEventsFromRipmail: vi.fn(),
}))

vi.mock('../lib/ripmailExec.js', () => ({
  execRipmailAsync: vi.fn(),
  ripmailProcessEnv: vi.fn(() => ({})),
}))

// Shared fixture: $BRAIN_HOME/wiki
let brainHome: string
let wikiDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'calendar-test-'))
  process.env.BRAIN_HOME = brainHome
  wikiDir = join(brainHome, 'wiki')
  await mkdir(wikiDir, { recursive: true })
  vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
    events: [],
    meta: { sourcesConfigured: true, ripmail: '2026-04-19T12:00:00Z' },
  })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.clearAllMocks()
})

describe('calendar tool', () => {
  it('op=events calls getCalendarEvents and returns JSON', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'calendar')!

    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: [{ id: 'e1', title: 'Meeting', start: '2026-04-20T10:00:00Z', end: '2026-04-20T11:00:00Z', allDay: false, source: 'google' }],
      meta: { sourcesConfigured: true, ripmail: '2026-04-19T12:00:00Z' },
    })

    const result = await tool.execute('c1', { op: 'events', start: '2026-04-20', end: '2026-04-20' })
    expect(result.content[0].text).toContain('Meeting')
    expect(getCalendarEventsFromRipmail).toHaveBeenCalledWith({ start: '2026-04-20', end: '2026-04-20', calendarIds: undefined })

    // Regression: events are included in details so the client preview card
    // can render them even when tool.result is truncated at 4000 chars by the SSE layer.
    expect(result.details.calendarPreview).toBe(true)
    expect(result.details.date).toBe('2026-04-20')
    expect(Array.isArray(result.details.events)).toBe(true)
    expect(result.details.events[0].title).toBe('Meeting')
    // Result text is the JSON array (for the LLM)
    expect(result.content[0].type).toBe('text')
    expect(result.content.length).toBe(1)
  })

  it('op=events does not show preview for multi-day range', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'calendar')!

    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: [],
      meta: { sourcesConfigured: true, ripmail: '2026-04-19T12:00:00Z' },
    })

    const result = await tool.execute('c-multi', { op: 'events', start: '2026-04-20', end: '2026-04-21' })
    expect(result.details.calendarPreview).toBeUndefined()
    // Only one text content block — no type:calendar sentinel
    expect(result.content.length).toBe(1)
    expect(result.content[0].type).toBe('text')
  })

  it('op=list_calendars calls ripmail calendar list-calendars', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'calendar')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"calendars": []}', stderr: '' })

    await tool.execute('c2', { op: 'list_calendars', source: 'src1' })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('calendar list-calendars --json --source "src1"'), expect.any(Object))
  })

  it('op=configure_source calls ripmail sources edit --calendar', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'calendar')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    const result = await tool.execute('c3', { op: 'configure_source', source: 'src1', calendar_ids: ['c1', 'c2'] })
    expect(execRipmailAsync).toHaveBeenCalledWith(expect.stringContaining('sources edit "src1" --calendar "c1" --calendar "c2" --json'), expect.any(Object))
    expect(result.content[0].text).toContain('Source src1 updated')
  })

  it('op=events passes calendar_ids to getCalendarEventsFromRipmail', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'calendar')!

    await tool.execute('c-filter', { op: 'events', start: '2026-04-20', end: '2026-04-20', calendar_ids: ['cal1'] })
    expect(getCalendarEventsFromRipmail).toHaveBeenCalledWith({ start: '2026-04-20', end: '2026-04-20', calendarIds: ['cal1'] })
  })

  it('op=configure_source supports default_calendar_ids', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'calendar')!

    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{"ok": true}', stderr: '' })

    await tool.execute('c-def', {
      op: 'configure_source',
      source: 'src1',
      calendar_ids: ['c1', 'c2'],
      default_calendar_ids: ['c1']
    })
    expect(execRipmailAsync).toHaveBeenCalledWith(
      expect.stringContaining('sources edit "src1" --calendar "c1" --calendar "c2" --default-calendar "c1" --json'),
      expect.any(Object)
    )
  })
})
