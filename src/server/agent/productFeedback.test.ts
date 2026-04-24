import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentTools } from './tools.js'
import { brainLayoutIssuesDir } from '../lib/brainLayout.js'

let brainHome: string
let wikiDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'pfb-'))
  wikiDir = join(brainHome, 'wiki')
  await mkdir(wikiDir, { recursive: true })
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('product_feedback tool', () => {
  it('op=submit with confirmed true writes an issue file', async () => {
    const tools = createAgentTools(wikiDir)
    const tool = tools.find(t => t.name === 'product_feedback')!
    const md = `---
type: bug
title: "Tool test"
---

## Summary

From tool.`
    const r = await tool.execute('t1', {
      op: 'submit',
      markdown: md,
      confirmed: true,
    } as { op: 'submit'; markdown: string; confirmed: boolean })
    const text = r.content[0] && r.content[0].type === 'text' ? r.content[0].text : ''
    expect(text).toContain('issue #1')
    const dir = brainLayoutIssuesDir(brainHome)
    const files = await readdir(dir)
    expect(files.some(f => f.includes('-issue-1.md'))).toBe(true)
  })

  it('op=submit without confirmed refuses', async () => {
    const tools = createAgentTools(wikiDir)
    const tool = tools.find(t => t.name === 'product_feedback')!
    const r = await tool.execute('t2', {
      op: 'submit',
      markdown: 'x',
      confirmed: false,
    } as { op: 'submit'; markdown: string; confirmed: boolean })
    const text = r.content[0] && r.content[0].type === 'text' ? r.content[0].text : ''
    expect(text).toMatch(/refusing|confirm/i)
  })
})
