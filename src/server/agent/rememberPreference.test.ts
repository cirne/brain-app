import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createAgentTools } from './tools.js'
import { existsSync } from 'node:fs'

describe('remember_preference tool', () => {
  let brainHome: string
  let wikiDir: string

  beforeEach(async () => {
    brainHome = await mkdtemp(join(tmpdir(), 'pref-test-'))
    wikiDir = join(brainHome, 'wiki')
    await mkdir(wikiDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(brainHome, { recursive: true, force: true })
  })

  it('creates me.md and ## Preferences section if missing', async () => {
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'remember_preference')!
    
    await tool.execute('t1', { preference: 'Always ignore my daughter\'s calendar' })
    
    const mePath = join(wikiDir, 'me.md')
    expect(existsSync(mePath)).toBe(true)
    const content = await readFile(mePath, 'utf8')
    expect(content).toContain('## Preferences')
    expect(content).toContain('- Always ignore my daughter\'s calendar')
  })

  it('appends to existing ## Preferences section', async () => {
    const mePath = join(wikiDir, 'me.md')
    await writeFile(mePath, '# Me\n\n## Preferences\n\n- Existing pref\n')
    
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'remember_preference')!
    
    await tool.execute('t2', { preference: 'New preference' })
    
    const content = await readFile(mePath, 'utf8')
    expect(content).toContain('- Existing pref')
    expect(content).toContain('- New preference')
    // Check order
    const lines = content.split('\n').filter(l => l.trim() !== '')
    const existingIdx = lines.indexOf('- Existing pref')
    const newIdx = lines.indexOf('- New preference')
    expect(newIdx).toBeGreaterThan(existingIdx)
  })

  it('handles optional section sub-heading', async () => {
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'remember_preference')!
    
    await tool.execute('t3', { preference: 'Lead with blockers', section: 'Style' })
    
    const content = await readFile(join(wikiDir, 'me.md'), 'utf8')
    expect(content).toContain('## Preferences')
    expect(content).toContain('### Style')
    expect(content).toContain('- Lead with blockers')
  })

  it('appends to existing section sub-heading', async () => {
    const mePath = join(wikiDir, 'me.md')
    await writeFile(mePath, '## Preferences\n\n### Style\n\n- Be concise\n')
    
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'remember_preference')!
    
    await tool.execute('t4', { preference: 'Use bullet points', section: 'Style' })
    
    const content = await readFile(mePath, 'utf8')
    expect(content).toContain('- Be concise')
    expect(content).toContain('- Use bullet points')
    const styleIdx = content.indexOf('### Style')
    const conciseIdx = content.indexOf('- Be concise')
    const bulletsIdx = content.indexOf('- Use bullet points')
    expect(conciseIdx).toBeGreaterThan(styleIdx)
    expect(bulletsIdx).toBeGreaterThan(conciseIdx)
  })

  it('creates new section sub-heading if missing in ## Preferences', async () => {
    const mePath = join(wikiDir, 'me.md')
    await writeFile(mePath, '## Preferences\n\n### General\n\n- Some general pref\n')
    
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'remember_preference')!
    
    await tool.execute('t5', { preference: 'Lead with blockers', section: 'Style' })
    
    const content = await readFile(mePath, 'utf8')
    expect(content).toContain('### General')
    expect(content).toContain('### Style')
    expect(content).toContain('- Lead with blockers')
    const generalIdx = content.indexOf('### General')
    const styleIdx = content.indexOf('### Style')
    expect(styleIdx).toBeGreaterThan(generalIdx)
  })

  it('does not overwrite content before ## Preferences', async () => {
    const mePath = join(wikiDir, 'me.md')
    const original = '# About Me\nI am a developer.\n\n## Goals\n- Learn Svelte 5\n'
    await writeFile(mePath, original)
    
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'remember_preference')!
    
    await tool.execute('t6', { preference: 'Prefer dark mode' })
    
    const content = await readFile(mePath, 'utf8')
    expect(content).toContain(original)
    expect(content).toContain('## Preferences')
    expect(content).toContain('- Prefer dark mode')
  })

  it('handles multiple top-level sections correctly', async () => {
    const mePath = join(wikiDir, 'me.md')
    await writeFile(mePath, '## Preferences\n\n- P1\n\n## Another Section\n\n- Something else\n')
    
    const tools = createAgentTools(wikiDir)
    const tool = tools.find((t: any) => t.name === 'remember_preference')!
    
    await tool.execute('t7', { preference: 'P2' })
    
    const content = await readFile(mePath, 'utf8')
    expect(content).toContain('- P1')
    expect(content).toContain('- P2')
    expect(content).toContain('## Another Section')
    
    const lines = content.split('\n').map(l => l.trim())
    const p1Idx = lines.indexOf('- P1')
    const p2Idx = lines.indexOf('- P2')
    const anotherIdx = lines.indexOf('## Another Section')
    
    expect(p2Idx).toBeGreaterThan(p1Idx)
    expect(anotherIdx).toBeGreaterThan(p2Idx)
  })
})
