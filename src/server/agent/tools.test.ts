import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { writeCache } from '../lib/calendarCache.js'

// Shared fixture: a temp wiki directory
let wikiDir: string

beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'tools-test-'))
  await mkdir(join(wikiDir, 'ideas'))
  await writeFile(join(wikiDir, 'ideas', 'foo.md'), '# Foo\nThis is a foo idea.')
  await writeFile(join(wikiDir, 'index.md'), '# Home\nWelcome to the wiki.')
  process.env.WIKI_DIR = wikiDir
})

afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
  delete process.env.WIKI_DIR
})

describe('createAgentTools', () => {
  it('returns an array of tools with expected names', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    expect(Array.isArray(tools)).toBe(true)
    const names = tools.map((t: any) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('edit')
    expect(names).toContain('write')
    expect(names).toContain('grep')
    expect(names).toContain('find')
    expect(names).toContain('search_email')
    expect(names).toContain('read_email')
    expect(names).toContain('git_commit_push')
    expect(names).toContain('find_person')
    expect(names).toContain('wiki_log')
    expect(names).toContain('get_calendar_events')
    expect(names).toContain('web_search')
  })

  it('web_search tool throws when EXA_API_KEY is not set', async () => {
    delete process.env.EXA_API_KEY
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'web_search')!
    await expect(tool.execute('test-ws-1', { query: 'test' })).rejects.toThrow('EXA_API_KEY')
  })

  it('read tool can read a wiki file', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const readTool = tools.find((t: any) => t.name === 'read')!
    const result = await readTool.execute('test-1', { path: 'index.md' })
    const text = result.content.map((c: any) => c.text).join('')
    expect(text).toContain('# Home')
  })

  describe('find_person tool', () => {
    let ripmailScript: string

    beforeEach(async () => {
      // Create a fake ripmail binary that outputs contact info when called with "who"
      ripmailScript = join(wikiDir, 'fake-ripmail')
      await writeFile(
        ripmailScript,
        `#!/bin/sh\necho "Alice Example <alice@example.com> (42 emails)"\n`
      )
      await chmod(ripmailScript, 0o755)
      process.env.RIPMAIL_BIN = ripmailScript

      // Add wiki files mentioning the person
      await writeFile(join(wikiDir, 'people', 'alice.md'), '# Alice\nAlice is a great collaborator.')
        .catch(async () => {
          await mkdir(join(wikiDir, 'people'))
          await writeFile(join(wikiDir, 'people', 'alice.md'), '# Alice\nAlice is a great collaborator.')
        })
      await writeFile(join(wikiDir, 'index.md'), '# Home\nMet Alice at the conference.')
    })

    afterEach(() => {
      delete process.env.RIPMAIL_BIN
    })

    it('combines email contacts and wiki notes', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t: any) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-1', { name: 'alice' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('Email Contacts')
      expect(text).toContain('alice@example.com')
      expect(text).toContain('Wiki Notes')
      expect(text).toMatch(/alice\.md|people\/alice/)
    })

    it('returns not-found message when no results', async () => {
      // Fake ripmail returns nothing
      await writeFile(ripmailScript, `#!/bin/sh\nexit 0\n`)
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t: any) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-2', { name: 'nobody' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('No information found for "nobody"')
    })

    it('returns wiki results even if ripmail fails', async () => {
      await writeFile(ripmailScript, `#!/bin/sh\nexit 1\n`)
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t: any) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-3', { name: 'alice' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('Wiki Notes')
      expect(text).not.toContain('Email Contacts')
    })
  })

  describe('get_calendar_events tool', () => {
    let cacheDir: string

    beforeEach(async () => {
      cacheDir = await mkdtemp(join(tmpdir(), 'cal-test-'))
      process.env.CALENDAR_CACHE_DIR = cacheDir
    })

    afterEach(async () => {
      await rm(cacheDir, { recursive: true, force: true })
      delete process.env.CALENDAR_CACHE_DIR
    })

    it('returns events in the requested date range', async () => {
      await writeCache('personal', [
        { id: 'e1', title: 'Team Lunch', start: '2026-04-12T12:00:00Z', end: '2026-04-12T13:00:00Z', allDay: false, source: 'personal' },
        { id: 'e2', title: 'Far Future', start: '2026-05-01T10:00:00Z', end: '2026-05-01T11:00:00Z', allDay: false, source: 'personal' },
      ])
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t: any) => t.name === 'get_calendar_events')!
      const result = await tool.execute('test-cal-1', { start: '2026-04-12', end: '2026-04-12' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('Team Lunch')
      expect(text).not.toContain('Far Future')
    })

    it('returns no-events message when cache is empty', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t: any) => t.name === 'get_calendar_events')!
      const result = await tool.execute('test-cal-2', { start: '2026-04-12', end: '2026-04-12' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('No events found')
    })
  })

  describe('wiki_log tool', () => {
    it('appends a correctly formatted entry to _log.md', async () => {
      await writeFile(join(wikiDir, '_log.md'), '# Log\n')
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t: any) => t.name === 'wiki_log')!
      await tool.execute('test-wl-1', { type: 'scaffold', description: 'Created people/alice page' })
      const log = await import('node:fs/promises').then(fs => fs.readFile(join(wikiDir, '_log.md'), 'utf8'))
      expect(log).toMatch(/## \[\d{4}-\d{2}-\d{2}\] scaffold \| Created people\/alice page/)
    })

    it('returns an error if _log.md does not exist', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t: any) => t.name === 'wiki_log')!
      await expect(tool.execute('test-wl-2', { type: 'ingest', description: 'test' })).rejects.toThrow()
    })
  })

  it('grep tool can search wiki content', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const grepTool = tools.find((t: any) => t.name === 'grep')!
    const result = await grepTool.execute('test-2', { pattern: 'foo idea', path: '.' })
    const text = result.content.map((c: any) => c.text).join('')
    expect(text).toContain('foo')
  })
})
