import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { getCalendarEventsFromRipmail } from '@server/lib/calendar/calendarRipmail.js'

vi.mock('@server/lib/calendar/calendarRipmail.js', () => ({
  getCalendarEventsFromRipmail: vi.fn(),
}))
vi.mock('@server/lib/ripmail/ripmailHeavySpawn.js', () => ({
  runRipmailRefreshForBrain: vi.fn(),
}))
import {
  buildDraftEditFlags,
  buildInboxRulesCommand,
  buildReindexCommand,
  buildRipmailSearchCommandLine,
  buildSourcesAddLocalDirCommand,
  buildSourcesEditCommand,
  buildSourcesRemoveCommand,
} from './tools.js'
import { joinToolResultText, toolResultFirstText } from './agentTestUtils.js'
import { runRipmailRefreshForBrain } from '@server/lib/ripmail/ripmailHeavySpawn.js'

// Shared fixture: $BRAIN_HOME/wiki
let brainHome: string
let wikiDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'tools-test-'))
  process.env.BRAIN_HOME = brainHome
  wikiDir = join(brainHome, 'wiki')
  vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
    events: [],
    meta: { sourcesConfigured: false, ripmail: '' },
  })
  await mkdir(join(wikiDir, 'ideas'), { recursive: true })
  await writeFile(join(wikiDir, 'ideas', 'foo.md'), '# Foo\nThis is a foo idea.')
  await writeFile(join(wikiDir, 'index.md'), '# Home\nWelcome to the wiki.')
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('createAgentTools', () => {
  it('returns an array of tools with expected names', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
    expect(Array.isArray(tools)).toBe(true)
    const names = tools.map((t) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('edit')
    expect(names).toContain('write')
    expect(names).toContain('grep')
    expect(names).toContain('find')
    expect(names).toContain('move_file')
    expect(names).toContain('delete_file')
    expect(names).toContain('search_index')
    expect(names).toContain('read_email')
    expect(names).toContain('read_attachment')
    expect(names).toContain('manage_sources')
    expect(names).toContain('refresh_sources')
    expect(names).toContain('list_inbox')
    expect(names).toContain('inbox_rules')
    expect(names).toContain('archive_emails')
    expect(names).toContain('find_person')
    expect(names).toContain('calendar')
    expect(names).toContain('web_search')
    expect(names).toContain('fetch_page')
    expect(names).toContain('get_youtube_transcript')
    expect(names).toContain('youtube_search')
    expect(names).toContain('set_chat_title')
    expect(names).toContain('open')
    expect(names).toContain('speak')
    expect(names).toContain('load_skill')
    expect(names).toContain('suggest_reply_options')
    expect(names).toContain('list_recent_messages')
    expect(names).toContain('get_message_thread')
  })

  it('omitToolNames removes listed tools by name', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, {
      includeLocalMessageTools: true,
      omitToolNames: ['inbox_rules', 'open', 'list_recent_messages'],
    })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('inbox_rules')
    expect(names).not.toContain('open')
    expect(names).not.toContain('list_recent_messages')
    expect(names).toContain('read')
    expect(names).toContain('get_message_thread')
  })

  it('onlyToolNames keeps only listed tools', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, {
      includeLocalMessageTools: false,
      onlyToolNames: ['read', 'write', 'search_index'],
    })
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['read', 'search_index', 'write'])
  })

  it('omits local message tools when includeLocalMessageTools is false', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const names = tools.map((t) => t.name)
    expect(names).not.toContain('list_recent_messages')
    expect(names).not.toContain('get_message_thread')
  })

  describe('set_chat_title tool', () => {
    it('returns confirmation with trimmed title', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'set_chat_title')!
      const result = await tool.execute('t-1', { title: '  Planning a trip to Lisbon  ' })
      expect(toolResultFirstText(result)).toContain('Planning a trip to Lisbon')
    })
  })

  describe('suggest_reply_options tool', () => {
    it('returns ok and normalized choices in details', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
      const tool = tools.find((t) => t.name === 'suggest_reply_options')!
      const result = await tool.execute('sro-1', {
        choices: [
          { label: '  Archive  ', submit: ' Archive thread abc ' },
          { label: 'Skip', submit: 'Skip this one', id: ' skip ' },
        ],
      })
      expect('details' in result && result.details && typeof result.details === 'object').toBe(true)
      const d = result.details as { choices: { label: string; submit: string; id?: string }[] }
      expect(d.choices).toEqual([
        { label: 'Archive', submit: 'Archive thread abc' },
        { label: 'Skip', submit: 'Skip this one', id: 'skip' },
      ])
      expect(toolResultFirstText(result)).toMatch(/Quick reply options/)
    })

    it('rejects duplicate labels (case-insensitive)', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
      const tool = tools.find((t) => t.name === 'suggest_reply_options')!
      const result = await tool.execute('sro-2', {
        choices: [
          { label: 'Yes', submit: 'a' },
          { label: 'yes', submit: 'b' },
        ],
      })
      expect(toolResultFirstText(result)).toMatch(/Duplicate labels/)
    })

    it('rejects overlong label', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
      const tool = tools.find((t) => t.name === 'suggest_reply_options')!
      const result = await tool.execute('sro-3', {
        choices: [{ label: 'x'.repeat(61), submit: 'ok' }],
      })
      expect(toolResultFirstText(result)).toMatch(/label exceeds/)
    })

    it('rejects overlong submit', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
      const tool = tools.find((t) => t.name === 'suggest_reply_options')!
      const result = await tool.execute('sro-4', {
        choices: [{ label: 'Ok', submit: 'x'.repeat(1001) }],
      })
      expect(toolResultFirstText(result)).toMatch(/submit exceeds/)
    })
  })

  describe('load_skill tool', () => {
    it('returns skill body for valid slug', async () => {
      const skillsRoot = join(brainHome, 'skills', 'myskill')
      await mkdir(skillsRoot, { recursive: true })
      await writeFile(
        join(skillsRoot, 'SKILL.md'),
        `---
name: My Skill
---
Hello {{selection}}`,
        'utf-8',
      )
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t) => t.name === 'load_skill')!
      const result = await tool.execute('t-ls-1', { slug: 'myskill' })
      const text = toolResultFirstText(result)
      expect(text).toContain('My Skill')
      expect(text).toContain('Hello')
      expect(text).not.toContain('{{selection}}')
    })

    it('rejects invalid slug characters', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t) => t.name === 'load_skill')!
      const result = await tool.execute('t-ls-2', { slug: 'bad/slug' })
      expect(toolResultFirstText(result)).toMatch(/Invalid skill slug/)
    })

    it('rejects path traversal in slug', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t) => t.name === 'load_skill')!
      const result = await tool.execute('t-ls-3', { slug: '..' })
      expect(toolResultFirstText(result)).toMatch(/Invalid skill slug/)
    })

    it('applies placeholders from skill request context', async () => {
      const skillsRoot = join(brainHome, 'skills', 'ph')
      await mkdir(skillsRoot, { recursive: true })
      await writeFile(
        join(skillsRoot, 'SKILL.md'),
        `---
name: ph
---
Sel: {{selection}} File: {{open_file}}`,
        'utf-8',
      )
      const { createAgentTools } = await import('./tools.js')
      const { runWithSkillRequestContext } = await import('@server/lib/llm/skillRequestContext.js')
      const tools = createAgentTools(wikiDir)
      const tool = tools.find((t) => t.name === 'load_skill')!
      const result = await runWithSkillRequestContext(
        { selection: 'hello', openFile: 'ideas/x.md' },
        () => tool.execute('t-ls-4', { slug: 'ph' }),
      )
      const text = toolResultFirstText(result)
      expect(text).toContain('hello')
      expect(text).toContain('ideas/x.md')
    })
  })

  describe('speak tool', () => {
    it('returns trimmed text and caps length', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'speak')!
      const long = 'x'.repeat(600)
      const result = await tool.execute('sp-1', { text: `  ${long}  ` })
      const text = joinToolResultText(result)
      expect(text.length).toBeLessThanOrEqual(480)
    })
  })

  describe('open tool', () => {
    it('returns confirmation text for wiki target', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'open')!
      const result = await tool.execute('o-1', {
        target: { type: 'wiki', path: 'ideas/foo.md' },
      })
      const text = joinToolResultText(result)
      expect(text).toContain('ideas/foo.md')
      expect(text).toContain('Opening wiki')
    })

    it('returns confirmation for email and calendar targets', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'open')!
      const e = await tool.execute('o-2', { target: { type: 'email', id: 'msg:1' } })
      expect(toolResultFirstText(e)).toContain('msg:1')
      const c = await tool.execute('o-3', { target: { type: 'calendar', date: '2026-04-20' } })
      expect(toolResultFirstText(c)).toContain('2026-04-20')
      expect(toolResultFirstText(c)).toContain('Monday')
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'fetch_page')!
      await expect(tool.execute('fp-1', { url: 'https://example.com' })).rejects.toThrow('SUPADATA_API_KEY')
    })

    it('returns page content as markdown', async () => {
      process.env.SUPADATA_API_KEY = 'test-key'
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({ content: '## Hello\nWorld', name: 'Example Page' }),
      }))
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'fetch_page')!
      const result = await tool.execute('fp-2', { url: 'https://example.com' })
      const text = joinToolResultText(result)
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'fetch_page')!
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'get_youtube_transcript')!
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'get_youtube_transcript')!
      const result = await tool.execute('yt-2', { url: 'https://youtube.com/watch?v=abc' })
      const text = joinToolResultText(result)
      expect(text).toBe('Hello world')
    })

    it('handles string content response', async () => {
      process.env.SUPADATA_API_KEY = 'test-key'
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({ content: 'Full transcript text', lang: 'en' }),
      }))
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'get_youtube_transcript')!
      const result = await tool.execute('yt-3', { url: 'https://youtube.com/watch?v=abc' })
      const text = joinToolResultText(result)
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'youtube_search')!
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'youtube_search')!
      const result = await tool.execute('ys-2', { query: 'svelte' })
      const text = joinToolResultText(result)
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'youtube_search')!
      const result = await tool.execute('ys-3', { query: 'nothing' })
      const text = joinToolResultText(result)
      expect(text).toBe('No results found.')
    })
  })

  it('web_search tool throws when EXA_API_KEY is not set', async () => {
    delete process.env.EXA_API_KEY
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
    const tool = tools.find((t) => t.name === 'web_search')!
    await expect(tool.execute('test-ws-1', { query: 'test' })).rejects.toThrow('EXA_API_KEY')
  })

  it('read tool can read a wiki file', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
    const readTool = tools.find((t) => t.name === 'read')!
    const result = await readTool.execute('test-1', { path: 'index.md' })
    const text = joinToolResultText(result)
    expect(text).toContain('# Home')
  })

  describe('wiki edit history (edit/write)', () => {
    let histFile: string

    beforeEach(async () => {
      await mkdir(join(brainHome, 'var'), { recursive: true })
      histFile = join(brainHome, 'var', 'wiki-edits.jsonl')
    })

    it('appends a JSONL line when edit tool succeeds', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const edit = tools.find((t) => t.name === 'edit')!
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const write = tools.find((t) => t.name === 'write')!
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

    it('write kebab-normalizes new files and appends history with the canonical path', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const write = tools.find((t) => t.name === 'write')!
      const out = (await write.execute('write-norm-1', {
        path: 'scratch/My Title Here.md',
        content: '# New\n',
      })) as { content: { type: string; text: string }[]; details?: { path?: string; requestedPath?: string } }
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(histFile, 'utf8')
      const rec = JSON.parse(raw.trim()) as { op: string; path: string }
      expect(rec.path).toBe('scratch/my-title-here.md')
      expect(out.content[0].text).toContain('scratch/my-title-here.md')
      expect(out.content[0].text).toContain('My Title Here.md')
      expect(out.details).toMatchObject({ path: 'scratch/my-title-here.md', requestedPath: 'scratch/My Title Here.md' })
    })

    it('does not append when edit fails', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const edit = tools.find((t) => t.name === 'edit')!
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

    it('lists top contacts when query is empty (ripmail who --limit 60)', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-empty', { query: '  ' })
      const text = joinToolResultText(result)
      expect(text).toContain('Email Contacts (top by frequency)')
      expect(text).toContain('alice@example.com')
    })

    it('combines email contacts and wiki notes', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-1', { query: 'alice' })
      const text = joinToolResultText(result)
      expect(text).toContain('Email Contacts')
      expect(text).toContain('alice@example.com')
      expect(text).toContain('Wiki Notes')
      expect(text).toMatch(/alice\.md|people\/alice/)
    })

    it('returns not-found message when no results', async () => {
      // Fake ripmail returns nothing
      await writeFile(ripmailScript, `#!/bin/sh\nexit 0\n`)
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-2', { query: 'nobody' })
      const text = joinToolResultText(result)
      expect(text).toContain('No information found for "nobody"')
    })

    it('returns wiki results even if ripmail fails', async () => {
      await writeFile(ripmailScript, `#!/bin/sh\nexit 1\n`)
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-3', { query: 'alice' })
      const text = joinToolResultText(result)
      expect(text).toContain('Wiki Notes')
      expect(text).not.toContain('Email Contacts')
    })

    it('matches phone number in wiki regardless of formatting', async () => {
      await writeFile(ripmailScript, `#!/bin/sh\nexit 0\n`)
      await writeFile(join(wikiDir, 'people', 'bob.md'), '# Bob\nPhone: (650) 248-5571\nBob is great.')
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'find_person')!
      const result = await tool.execute('test-fp-phone', { query: '+16502485571' })
      const text = joinToolResultText(result)
      expect(text).toContain('Wiki Notes')
      expect(text).toContain('bob.md')
    })
  })

  describe('calendar tool', () => {
    it('returns events in the requested date range', async () => {
      vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
        events: [
          { id: 'e1', title: 'Team Lunch', start: '2026-04-12T12:00:00Z', end: '2026-04-12T13:00:00Z', allDay: false, source: 'googleCalendar' },
        ],
        meta: { sourcesConfigured: true, ripmail: 'x' },
      })
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'calendar')!
      const result = await tool.execute('test-cal-1', { op: 'events', start: '2026-04-12', end: '2026-04-12' })
      const text = joinToolResultText(result)
      expect(text).toContain('Team Lunch')
    })

    it('includes startDayOfWeek and endDayOfWeek in JSON for the agent', async () => {
      vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
        events: [
          { id: 'e1', title: 'All day Mon', start: '2026-04-20', end: '2026-04-21', allDay: true, source: 'googleCalendar' },
        ],
        meta: { sourcesConfigured: true, ripmail: 'x' },
      })
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'calendar')!
      const result = await tool.execute('test-cal-dow', { op: 'events', start: '2026-04-20', end: '2026-04-20' })
      const text = joinToolResultText(result)
      expect(text).toContain('"startDayOfWeek":"Monday"')
      expect(text).toContain('"endDayOfWeek":"Monday"')
    })

    it('returns no-events message when cache is empty', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'calendar')!
      const result = await tool.execute('test-cal-2', { op: 'events', start: '2026-04-12', end: '2026-04-12' })
      const text = joinToolResultText(result)
      expect(text).toContain('No calendar sources')
    })

    it('create_event requires source and title', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'calendar')!
      await expect(
        tool.execute('test-cal-ce-1', { op: 'create_event', source: 'x-gcal' } as never),
      ).rejects.toThrow(/source and title/)
    })

    it('runs create-event and refresh', async () => {
      const ripmailScript = join(wikiDir, 'fake-ripmail-cal-create')
      await writeFile(
        ripmailScript,
        `#!/bin/sh
if [ "$1" = "calendar" ] && [ "$2" = "create-event" ]; then
  echo '{"id":"evt-new","htmlLink":"https://calendar.example/e"}'
  exit 0
fi
echo 'bad'
exit 1
`,
      )
      await chmod(ripmailScript, 0o755)
      process.env.RIPMAIL_BIN = ripmailScript
      vi.mocked(runRipmailRefreshForBrain).mockClear()

      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'calendar')!
      const result = await tool.execute('test-cal-ce-2', {
        op: 'create_event',
        source: 'user_gmail_com-gcal',
        title: 'Standup',
        event_start: '2026-04-23T10:00:00-04:00',
        event_end: '2026-04-23T10:30:00-04:00',
      })
      const text = joinToolResultText(result)
      expect(text).toContain('evt-new')
      expect((result.details as { id?: string }).id).toBe('evt-new')
      expect(vi.mocked(runRipmailRefreshForBrain)).toHaveBeenCalledWith(['--source', 'user_gmail_com-gcal'])

      delete process.env.RIPMAIL_BIN
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'list_inbox')!
      const result = await tool.execute('li-1', {})
      expect(toolResultFirstText(result)).toContain('mid-1')
      expect((result.details as { mailboxes?: { items?: { messageId: string }[] }[] }).mailboxes?.[0]?.items?.[0]?.messageId).toBe(
        'mid-1'
      )
    })
  })

  describe('inbox_rules tool', () => {
    let ripmailScript: string

    beforeEach(async () => {
      ripmailScript = join(wikiDir, 'fake-ripmail-rules')
      await writeFile(
        ripmailScript,
        `#!/bin/sh
if [ "$1" = "rules" ]; then
  echo '{"stub":"rules","op":"'$2'"}'
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

    it('runs ripmail rules list and parses JSON details', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'inbox_rules')!
      const result = await tool.execute('ir-1', { op: 'list' })
      expect(toolResultFirstText(result)).toContain('stub')
      expect((result.details as { stub?: string }).stub).toBe('rules')
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'archive_emails')!
      const result = await tool.execute('ae-1', { message_ids: ['msg-a', 'msg-b'] })
      expect(toolResultFirstText(result)).toContain('Archived 2 message(s)')
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'edit_draft')!
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
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const tool = tools.find((t) => t.name === 'edit_draft')!
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
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
    const grepTool = tools.find((t) => t.name === 'grep')!
    const result = await grepTool.execute('test-2', { pattern: 'foo idea', path: '.' })
    const text = joinToolResultText(result)
    expect(text).toContain('foo')
  })

  describe('move_file and delete_file tools', () => {
    let histFile: string

    beforeEach(async () => {
      await mkdir(join(brainHome, 'var'), { recursive: true })
      histFile = join(brainHome, 'var', 'wiki-edits.jsonl')
    })

    it('move_file renames within the wiki and appends history', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const move = tools.find((t) => t.name === 'move_file')!
      const result = await move.execute('mv-1', { from: 'ideas/foo.md', to: 'ideas/bar.md' })
      expect(toolResultFirstText(result)).toContain('ideas/foo.md')
      expect(toolResultFirstText(result)).toContain('ideas/bar.md')
      const { readFile, access } = await import('node:fs/promises')
      await expect(access(join(wikiDir, 'ideas', 'bar.md'))).resolves.toBeUndefined()
      await expect(access(join(wikiDir, 'ideas', 'foo.md'))).rejects.toMatchObject({ code: 'ENOENT' })
      const raw = await readFile(histFile, 'utf8')
      const rec = JSON.parse(raw.trim()) as { op: string; path: string; fromPath?: string }
      expect(rec.op).toBe('move')
      expect(rec.path).toBe('ideas/bar.md')
      expect(rec.fromPath).toBe('ideas/foo.md')
    })

    it('move_file kebab-normalizes the destination', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const move = tools.find((t) => t.name === 'move_file')!
      const result = await move.execute('mv-2', { from: 'index.md', to: 'Home Renamed.md' })
      const text = toolResultFirstText(result)
      expect(text).toContain('home-renamed.md')
      expect(text).toContain('Home Renamed.md')
    })

    it('move_file rejects path traversal', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const move = tools.find((t) => t.name === 'move_file')!
      await expect(move.execute('mv-bad', { from: 'ideas/foo.md', to: '../../../etc/passwd' })).rejects.toThrow(
        'wiki directory',
      )
    })

    it('move_file fails when destination exists', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const move = tools.find((t) => t.name === 'move_file')!
      await expect(
        move.execute('mv-dup', { from: 'ideas/foo.md', to: 'index.md' }),
      ).rejects.toThrow('already exists')
    })

    it('delete_file removes a wiki file and appends history', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const del = tools.find((t) => t.name === 'delete_file')!
      const result = await del.execute('del-1', { path: 'ideas/foo.md' })
      expect(toolResultFirstText(result)).toContain('ideas/foo.md')
      const { access, readFile } = await import('node:fs/promises')
      await expect(access(join(wikiDir, 'ideas', 'foo.md'))).rejects.toMatchObject({ code: 'ENOENT' })
      const raw = await readFile(histFile, 'utf8')
      const rec = JSON.parse(raw.trim()) as { op: string; path: string }
      expect(rec.op).toBe('delete')
      expect(rec.path).toBe('ideas/foo.md')
    })

    it('delete_file rejects path traversal', async () => {
      const { createAgentTools } = await import('./tools.js')
      const tools = createAgentTools(wikiDir, { includeLocalMessageTools: true })
      const del = tools.find((t) => t.name === 'delete_file')!
      await expect(del.execute('del-bad', { path: '../../../etc/passwd' })).rejects.toThrow('wiki directory')
    })
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

describe('buildRipmailSearchCommandLine', () => {
  it('builds pattern-only and filter-only command lines', () => {
    expect(buildRipmailSearchCommandLine({ query: 'foo|bar' })).toBe(
      'ripmail search "foo|bar" --json',
    )
    expect(buildRipmailSearchCommandLine({ from: 'a@x.com' })).toBe(
      'ripmail search --from "a@x.com" --json',
    )
  })

  it('adds structured flags, case-sensitive, and source', () => {
    expect(
      buildRipmailSearchCommandLine({
        pattern: 'x',
        to: 'b@y.com',
        after: '7d',
        before: '2026-01-01',
        subject: 'inv',
        category: 'work,personal',
        caseSensitive: true,
        source: 'acct-1',
      }),
    ).toBe(
      'ripmail search "x" --to "b@y.com" --after "7d" --before "2026-01-01" --subject "inv" --category "work,personal" --case-sensitive --json --source "acct-1"',
    )
  })

  it('treats pattern as alias of query', () => {
    expect(buildRipmailSearchCommandLine({ pattern: 'z' })).toBe('ripmail search "z" --json')
  })
})

describe('buildInboxRulesCommand', () => {
  it('builds list and validate with sample', () => {
    expect(buildInboxRulesCommand({ op: 'list' })).toBe('rules list')
    expect(buildInboxRulesCommand({ op: 'validate', sample: true })).toBe('rules validate --sample')
  })

  it('builds add with structured from, optional flags and source', () => {
    expect(
      buildInboxRulesCommand({
        op: 'add',
        rule_action: 'ignore',
        from: 'spam@x.com',
        query: 'digest|unsubscribe',
        insert_before: 'def-otp',
        source: 'u@mail.com',
      })
    ).toBe(
      'rules add --action ignore --query "digest|unsubscribe" --from "spam@x.com" --insert-before "def-otp" --source "u@mail.com"'
    )
  })

  it('builds add with from only and from-or-to-union', () => {
    expect(
      buildInboxRulesCommand({
        op: 'add',
        rule_action: 'ignore',
        from: 'a@x.com',
        to: 'b@y.com',
        from_or_to_union: true,
      })
    ).toBe('rules add --action ignore --from "a@x.com" --to "b@y.com" --from-or-to-union')
  })

  it('builds add with message-only thread scope', () => {
    expect(
      buildInboxRulesCommand({
        op: 'add',
        rule_action: 'ignore',
        query: 'golf',
        apply_to_thread: false,
      })
    ).toBe('rules add --action ignore --query "golf" --message-only')
  })

  it('builds edit with whole-thread flag', () => {
    expect(
      buildInboxRulesCommand({
        op: 'edit',
        rule_id: 'r1',
        apply_to_thread: true,
      })
    ).toBe('rules edit "r1" --whole-thread')
  })

  it('builds edit with structured field and from_or_to_union', () => {
    expect(
      buildInboxRulesCommand({
        op: 'edit',
        rule_id: 'r1',
        subject: 'invoice',
        from_or_to_union: false,
      })
    ).toBe('rules edit "r1" --subject "invoice" --from-or-to-union false')
  })

  it('builds move with before', () => {
    expect(
      buildInboxRulesCommand({
        op: 'move',
        rule_id: 'a1',
        before_rule_id: 'b2',
      })
    ).toBe('rules move "a1" --before "b2"')
  })

  it('builds feedback', () => {
    expect(
      buildInboxRulesCommand({
        op: 'feedback',
        feedback_text: 'hide newsletters',
      })
    ).toBe('rules feedback "hide newsletters"')
  })

  it('throws when move has both or neither anchor ids', () => {
    expect(() =>
      buildInboxRulesCommand({ op: 'move', rule_id: 'x', before_rule_id: 'a', after_rule_id: 'b' })
    ).toThrow('exactly one')
    expect(() => buildInboxRulesCommand({ op: 'move', rule_id: 'x' })).toThrow('exactly one')
  })

  it('throws when add has no query and no structured filters', () => {
    expect(() =>
      buildInboxRulesCommand({ op: 'add', rule_action: 'ignore' }),
    ).toThrow('op=add requires')
  })
})

describe('ripmail sources / refresh command builders', () => {
  it('buildSourcesAddLocalDirCommand builds add with path, label, id, json', () => {
    expect(buildSourcesAddLocalDirCommand({ path: '~/Documents' })).toBe(
      'sources add --kind localDir --path "~/Documents" --json',
    )
    expect(buildSourcesAddLocalDirCommand({ path: '/a/b', label: 'Work' })).toBe(
      'sources add --kind localDir --path "/a/b" --label "Work" --json',
    )
    expect(buildSourcesAddLocalDirCommand({ path: '/x', id: 'my-id' })).toBe(
      'sources add --kind localDir --path "/x" --id "my-id" --json',
    )
  })

  it('buildSourcesEditCommand builds edit with optional fields', () => {
    expect(buildSourcesEditCommand({ id: 'abc' })).toBe('sources edit "abc" --json')
    expect(buildSourcesEditCommand({ id: 'abc', label: 'L' })).toBe('sources edit "abc" --label "L" --json')
    expect(buildSourcesEditCommand({ id: 'abc', path: '/p' })).toBe('sources edit "abc" --path "/p" --json')
  })

  it('buildSourcesRemoveCommand', () => {
    expect(buildSourcesRemoveCommand('src-1')).toBe('sources remove "src-1" --json')
  })

  it('buildReindexCommand', () => {
    expect(buildReindexCommand({})).toBe('refresh')
    expect(buildReindexCommand({ sourceId: 'docs' })).toBe('refresh --source "docs"')
  })
})

describe('refresh_sources tool', () => {
  beforeEach(() => {
    vi.mocked(runRipmailRefreshForBrain).mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
      signal: null,
      durationMs: 0,
      timedOut: false,
      pid: undefined,
    })
  })

  afterEach(() => {
    vi.mocked(runRipmailRefreshForBrain).mockClear()
    delete process.env.RIPMAIL_BIN
  })

  it('starts refresh for all sources when source omitted', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const tool = tools.find((t) => t.name === 'refresh_sources')!
    const result = await tool.execute('rs-1', {})
    expect(runRipmailRefreshForBrain).toHaveBeenCalledWith([])
    expect(joinToolResultText(result)).toContain('all sources')
  })

  it('passes --source argv when source provided', async () => {
    const failRipmail = join(wikiDir, 'fake-ripmail-fail')
    await writeFile(failRipmail, '#!/bin/sh\nexit 1\n')
    await chmod(failRipmail, 0o755)
    process.env.RIPMAIL_BIN = failRipmail

    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const tool = tools.find((t) => t.name === 'refresh_sources')!
    await tool.execute('rs-2', { source: 'work@example.com' })
    expect(runRipmailRefreshForBrain).toHaveBeenCalledWith(['--source', 'work@example.com'])
  })
})

