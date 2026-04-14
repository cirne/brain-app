import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { writeCache } from '../lib/calendarCache.js'
import { buildDraftEditFlags, normalizePhoneDigits, phoneToFlexibleGrepPattern } from './tools.js'

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
    const tools = createAgentTools(wikiDir, { includeImessageTools: true })
    expect(Array.isArray(tools)).toBe(true)
    const names = tools.map((t: any) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('edit')
    expect(names).toContain('write')
    expect(names).toContain('grep')
    expect(names).toContain('find')
    expect(names).toContain('search_email')
    expect(names).toContain('read_email')
    expect(names).toContain('list_inbox')
    expect(names).toContain('archive_emails')
    expect(names).toContain('find_person')
    expect(names).toContain('wiki_log')
    expect(names).toContain('get_calendar_events')
    expect(names).toContain('web_search')
    expect(names).toContain('fetch_page')
    expect(names).toContain('get_youtube_transcript')
    expect(names).toContain('youtube_search')
    expect(names).toContain('set_chat_title')
    expect(names).toContain('open')
    expect(names).toContain('list_imessage_recent')
    expect(names).toContain('get_imessage_thread')
  })

  it('omits iMessage tools when includeImessageTools is false', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeImessageTools: false })
    const names = tools.map((t: { name: string }) => t.name)
    expect(names).not.toContain('list_imessage_recent')
    expect(names).not.toContain('get_imessage_thread')
  })

  describe('set_chat_title tool', () => {
    it('returns confirmation with trimmed title', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: { name: string }) => t.name === 'set_chat_title')!
      const result = await tool.execute('t-1', { title: '  Planning a trip to Lisbon  ' })
      expect(result.content[0].text).toContain('Planning a trip to Lisbon')
    })
  })

  describe('open tool', () => {
    it('returns confirmation text for wiki target', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: { name: string }) => t.name === 'open')!
      const result = await tool.execute('o-1', {
        target: { type: 'wiki', path: 'ideas/foo.md' },
      })
      const text = result.content.map((c: { text: string }) => c.text).join('')
      expect(text).toContain('ideas/foo.md')
      expect(text).toContain('Opening wiki')
    })

    it('returns confirmation for email and calendar targets', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: { name: string }) => t.name === 'open')!
      const e = await tool.execute('o-2', { target: { type: 'email', id: 'msg:1' } })
      expect(e.content[0].text).toContain('msg:1')
      const c = await tool.execute('o-3', { target: { type: 'calendar', date: '2026-06-01' } })
      expect(c.content[0].text).toContain('2026-06-01')
    })
  })

  describe('fetch_page tool', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      delete process.env.SUPADATA_API_KEY
    })

    it('throws when SUPADATA_API_KEY is not set', async () => {
      delete process.env.SUPADATA_API_KEY
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'fetch_page')!
      await expect(tool.execute('fp-1', { url: 'https://example.com' })).rejects.toThrow('SUPADATA_API_KEY')
    })

    it('returns page content as markdown', async () => {
      process.env.SUPADATA_API_KEY = 'test-key'
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({ content: '## Hello\nWorld', name: 'Example Page' }),
      }))
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'fetch_page')!
      const result = await tool.execute('fp-2', { url: 'https://example.com' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('Example Page')
      expect(text).toContain('## Hello')
    })

    it('throws on non-ok HTTP response', async () => {
      process.env.SUPADATA_API_KEY = 'test-key'
      vi.stubGlobal('fetch', async () => ({
        ok: false,
        status: 429,
        text: async () => 'rate limited',
      }))
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'fetch_page')!
      await expect(tool.execute('fp-3', { url: 'https://example.com' })).rejects.toThrow('429')
    })
  })

  describe('get_youtube_transcript tool', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      delete process.env.SUPADATA_API_KEY
    })

    it('throws when SUPADATA_API_KEY is not set', async () => {
      delete process.env.SUPADATA_API_KEY
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'get_youtube_transcript')!
      await expect(tool.execute('yt-1', { url: 'https://youtube.com/watch?v=abc' })).rejects.toThrow('SUPADATA_API_KEY')
    })

    it('joins transcript segments into plain text', async () => {
      process.env.SUPADATA_API_KEY = 'test-key'
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({
          content: [{ text: 'Hello' }, { text: 'world' }],
          lang: 'en',
        }),
      }))
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'get_youtube_transcript')!
      const result = await tool.execute('yt-2', { url: 'https://youtube.com/watch?v=abc' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toBe('Hello world')
    })

    it('handles string content response', async () => {
      process.env.SUPADATA_API_KEY = 'test-key'
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({ content: 'Full transcript text', lang: 'en' }),
      }))
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'get_youtube_transcript')!
      const result = await tool.execute('yt-3', { url: 'https://youtube.com/watch?v=abc' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toBe('Full transcript text')
    })
  })

  describe('youtube_search tool', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      delete process.env.SUPADATA_API_KEY
    })

    it('throws when SUPADATA_API_KEY is not set', async () => {
      delete process.env.SUPADATA_API_KEY
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'youtube_search')!
      await expect(tool.execute('ys-1', { query: 'svelte tutorial' })).rejects.toThrow('SUPADATA_API_KEY')
    })

    it('formats results as markdown links', async () => {
      process.env.SUPADATA_API_KEY = 'test-key'
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({
          items: [
            { videoId: 'abc123', title: 'Svelte Tutorial', channelTitle: 'Fireship' },
            { videoId: 'def456', title: 'Svelte 5 Runes', channelTitle: 'Kevin Powell' },
          ],
        }),
      }))
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'youtube_search')!
      const result = await tool.execute('ys-2', { query: 'svelte' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('Svelte Tutorial')
      expect(text).toContain('youtube.com/watch?v=abc123')
      expect(text).toContain('Fireship')
    })

    it('returns no-results message for empty response', async () => {
      process.env.SUPADATA_API_KEY = 'test-key'
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({ items: [] }),
      }))
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'youtube_search')!
      const result = await tool.execute('ys-3', { query: 'nothing' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toBe('No results found.')
    })
  })

  it('web_search tool throws when EXA_API_KEY is not set', async () => {
    delete process.env.EXA_API_KEY
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeImessageTools: true })
    const tool = tools.find((t: any) => t.name === 'web_search')!
    await expect(tool.execute('test-ws-1', { query: 'test' })).rejects.toThrow('EXA_API_KEY')
  })

  it('read tool can read a wiki file', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeImessageTools: true })
    const readTool = tools.find((t: any) => t.name === 'read')!
    const result = await readTool.execute('test-1', { path: 'index.md' })
    const text = result.content.map((c: any) => c.text).join('')
    expect(text).toContain('# Home')
  })

  describe('wiki edit history (edit/write)', () => {
    let histFile: string

    beforeEach(() => {
      histFile = join(wikiDir, 'wiki-edits-test.jsonl')
      process.env.WIKI_EDIT_HISTORY_PATH = histFile
    })

    afterEach(() => {
      delete process.env.WIKI_EDIT_HISTORY_PATH
    })

    it('appends a JSONL line when edit tool succeeds', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const edit = tools.find((t: any) => t.name === 'edit')!
      await edit.execute('edit-hist-1', {
        path: 'index.md',
        edits: [{ oldText: 'Welcome to the wiki.', newText: 'Hi.' }],
      })
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(histFile, 'utf8')
      const rec = JSON.parse(raw.trim()) as { op: string; path: string; source: string }
      expect(rec.op).toBe('edit')
      expect(rec.path).toBe('index.md')
      expect(rec.source).toBe('agent')
    })

    it('appends a JSONL line when write tool succeeds', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const write = tools.find((t: any) => t.name === 'write')!
      await write.execute('write-hist-1', {
        path: 'scratch/new-note.md',
        content: '# New\n',
      })
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(histFile, 'utf8')
      const rec = JSON.parse(raw.trim()) as { op: string; path: string }
      expect(rec.op).toBe('write')
      expect(rec.path).toBe('scratch/new-note.md')
    })

    it('does not append when edit fails', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const edit = tools.find((t: any) => t.name === 'edit')!
      await expect(
        edit.execute('edit-fail', {
          path: 'index.md',
          edits: [{ oldText: 'text not in file', newText: 'x' }],
        })
      ).rejects.toThrow()
      const { access } = await import('node:fs/promises')
      await expect(access(histFile)).rejects.toMatchObject({ code: 'ENOENT' })
    })
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
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-1', { query: 'alice' })
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
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-2', { query: 'nobody' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('No information found for "nobody"')
    })

    it('returns wiki results even if ripmail fails', async () => {
      await writeFile(ripmailScript, `#!/bin/sh\nexit 1\n`)
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-3', { query: 'alice' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('Wiki Notes')
      expect(text).not.toContain('Email Contacts')
    })

    it('matches phone number in wiki regardless of formatting', async () => {
      await writeFile(ripmailScript, `#!/bin/sh\nexit 0\n`)
      await writeFile(join(wikiDir, 'people', 'bob.md'), '# Bob\nPhone: (650) 248-5571\nBob is great.')
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-phone', { query: '+16502485571' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('Wiki Notes')
      expect(text).toContain('bob.md')
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
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'get_calendar_events')!
      const result = await tool.execute('test-cal-1', { start: '2026-04-12', end: '2026-04-12' })
      const text = result.content.map((c: any) => c.text).join('')
      expect(text).toContain('Team Lunch')
      expect(text).not.toContain('Far Future')
    })

    it('returns no-events message when cache is empty', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
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
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'wiki_log')!
      await tool.execute('test-wl-1', { type: 'scaffold', description: 'Created people/alice page' })
      const log = await import('node:fs/promises').then(fs => fs.readFile(join(wikiDir, '_log.md'), 'utf8'))
      expect(log).toMatch(/## \[\d{4}-\d{2}-\d{2}\] scaffold \| Created people\/alice page/)
    })

    it('returns an error if _log.md does not exist', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'wiki_log')!
      await expect(tool.execute('test-wl-2', { type: 'ingest', description: 'test' })).rejects.toThrow()
    })
  })

  describe('list_inbox tool', () => {
    let ripmailScript: string

    beforeEach(async () => {
      ripmailScript = join(wikiDir, 'fake-ripmail-inbox')
      await writeFile(
        ripmailScript,
        `#!/bin/sh
if [ "$1" = "inbox" ]; then
  echo '{"mailboxes":[{"id":"mb1","items":[{"messageId":"mid-1","subject":"Hello","action":"inform"}]}]}'
else
  exit 1
fi
`
      )
      await chmod(ripmailScript, 0o755)
      process.env.RIPMAIL_BIN = ripmailScript
    })

    afterEach(() => {
      delete process.env.RIPMAIL_BIN
    })

    it('runs ripmail inbox and returns JSON in content and details', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'list_inbox')!
      const result = await tool.execute('li-1', {})
      expect(result.content[0].text).toContain('mid-1')
      expect((result.details as { mailboxes?: { items?: { messageId: string }[] }[] }).mailboxes?.[0]?.items?.[0]?.messageId).toBe(
        'mid-1'
      )
    })
  })

  describe('archive_emails tool', () => {
    let ripmailScript: string

    beforeEach(async () => {
      ripmailScript = join(wikiDir, 'fake-ripmail-archive')
      await writeFile(
        ripmailScript,
        `#!/bin/sh
echo "$@" >> ${join(wikiDir, 'ripmail-archive.log')}
`
      )
      await chmod(ripmailScript, 0o755)
      process.env.RIPMAIL_BIN = ripmailScript
    })

    afterEach(() => {
      delete process.env.RIPMAIL_BIN
    })

    it('runs ripmail archive for each message id', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'archive_emails')!
      const result = await tool.execute('ae-1', { message_ids: ['msg-a', 'msg-b'] })
      expect(result.content[0].text).toContain('Archived 2 message(s)')
      const { readFile } = await import('node:fs/promises')
      const log = await readFile(join(wikiDir, 'ripmail-archive.log'), 'utf8')
      expect(log).toContain('archive')
      expect(log).toContain('msg-a')
      expect(log).toContain('msg-b')
    })
  })

  describe('edit_draft tool metadata params', () => {
    let ripmailScript: string

    beforeEach(async () => {
      ripmailScript = join(wikiDir, 'fake-ripmail-draft')
      // Fake ripmail that records the command and returns a draft
      await writeFile(
        ripmailScript,
        `#!/bin/sh
if echo "$@" | grep -q "draft view"; then
  echo '{"id":"d1","to":["a@x.com","b@x.com"],"cc":["c@x.com"],"subject":"Updated","body":"Hello"}'
else
  echo "$@" >> ${join(wikiDir, 'ripmail-calls.log')}
fi
`
      )
      await chmod(ripmailScript, 0o755)
      process.env.RIPMAIL_BIN = ripmailScript
    })

    afterEach(() => {
      delete process.env.RIPMAIL_BIN
    })

    it('passes add_cc flags to ripmail', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'edit_draft')!
      const result = await tool.execute('ed-1', {
        draft_id: 'd1',
        add_cc: ['bob@example.com'],
        instruction: 'make it shorter',
      })
      expect(result.details.cc).toContain('c@x.com')
      const { readFile } = await import('node:fs/promises')
      const log = await readFile(join(wikiDir, 'ripmail-calls.log'), 'utf8')
      expect(log).toContain('--add-cc')
      expect(log).toContain('bob@example.com')
    })

    it('works with metadata-only edit (no body instruction)', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeImessageTools: true })
      const tool = tools.find((t: any) => t.name === 'edit_draft')!
      const result = await tool.execute('ed-2', {
        draft_id: 'd1',
        subject: 'New Subject',
        remove_to: ['old@example.com'],
      })
      expect(result.details.id).toBe('d1')
      const { readFile } = await import('node:fs/promises')
      const log = await readFile(join(wikiDir, 'ripmail-calls.log'), 'utf8')
      expect(log).toContain('--subject')
      expect(log).toContain('--remove-to')
    })
  })

  it('grep tool can search wiki content', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeImessageTools: true })
    const grepTool = tools.find((t: any) => t.name === 'grep')!
    const result = await grepTool.execute('test-2', { pattern: 'foo idea', path: '.' })
    const text = result.content.map((c: any) => c.text).join('')
    expect(text).toContain('foo')
  })
})

describe('buildDraftEditFlags', () => {
  it('returns empty string when no metadata provided', () => {
    expect(buildDraftEditFlags({})).toBe('')
  })

  it('builds subject flag', () => {
    expect(buildDraftEditFlags({ subject: 'New Subject' })).toBe('--subject "New Subject" ')
  })

  it('builds add_cc flags for multiple addresses', () => {
    const result = buildDraftEditFlags({ add_cc: ['a@x.com', 'b@x.com'] })
    expect(result).toBe('--add-cc "a@x.com" --add-cc "b@x.com" ')
  })

  it('builds combined flags', () => {
    const result = buildDraftEditFlags({
      subject: 'Hi',
      add_to: ['new@x.com'],
      remove_cc: ['old@x.com'],
    })
    expect(result).toContain('--subject "Hi"')
    expect(result).toContain('--add-to "new@x.com"')
    expect(result).toContain('--remove-cc "old@x.com"')
  })

  it('ignores empty arrays', () => {
    expect(buildDraftEditFlags({ add_cc: [] })).toBe('')
  })
})

describe('normalizePhoneDigits', () => {
  it('strips +1 country code from US number', () => {
    expect(normalizePhoneDigits('+16502485571')).toBe('6502485571')
  })

  it('handles dashes and parens', () => {
    expect(normalizePhoneDigits('(650) 248-5571')).toBe('6502485571')
  })

  it('handles bare 10-digit number', () => {
    expect(normalizePhoneDigits('6502485571')).toBe('6502485571')
  })

  it('returns null for names', () => {
    expect(normalizePhoneDigits('Alice')).toBeNull()
    expect(normalizePhoneDigits('alice example')).toBeNull()
  })

  it('returns null for very short input', () => {
    expect(normalizePhoneDigits('123')).toBeNull()
  })
})

describe('phoneToFlexibleGrepPattern', () => {
  it('builds regex with [^0-9]* between digits', () => {
    const pattern = phoneToFlexibleGrepPattern('6502485571')
    expect(pattern).toBe('6[^0-9]*5[^0-9]*0[^0-9]*2[^0-9]*4[^0-9]*8[^0-9]*5[^0-9]*5[^0-9]*7[^0-9]*1')
  })

  it('generated pattern matches various phone formats', () => {
    const pattern = phoneToFlexibleGrepPattern('6502485571')
    const re = new RegExp(pattern)
    expect(re.test('650-248-5571')).toBe(true)
    expect(re.test('(650) 248-5571')).toBe(true)
    expect(re.test('650.248.5571')).toBe(true)
    expect(re.test('6502485571')).toBe(true)
    expect(re.test('+1 650 248 5571')).toBe(true)
    expect(re.test('5551234567')).toBe(false)
  })
})
