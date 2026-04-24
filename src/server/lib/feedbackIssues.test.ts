import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getFeedbackIssueById,
  listFeedbackIssues,
  writeFeedbackIssue,
  writeFeedbackIssueFromMarkdown,
  submitFeedbackMarkdown,
} from './feedbackIssues.js'
import { ensureTenantHomeDir, tenantHomeDir } from './dataRoot.js'
import { brainLayoutIssuesDir, brainLayoutWikiDir } from './brainLayout.js'
import { runWithTenantContextAsync } from './tenantContext.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'fb-iss-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('feedbackIssues', () => {
  it('allocates id and round-trips list/get', async () => {
    await writeFeedbackIssue(brainHome, {
      type: 'bug',
      title: 'Test title',
      summary: 'Summary line',
    })
    const list = await listFeedbackIssues(brainHome)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(1)
    expect(list[0]!.title).toBe('Test title')

    const got = await getFeedbackIssueById(brainHome, 1)
    expect(got).not.toBeNull()
    expect(got!.content).toContain('Test title')
  })

  it('writeFeedbackIssueFromMarkdown stores file', async () => {
    const md = `---
type: bug
title: From raw
---

## Summary

Hello.`
    const { id, filename } = await writeFeedbackIssueFromMarkdown(brainHome, md)
    expect(id).toBe(1)
    const raw = await readFile(join(brainLayoutIssuesDir(brainHome), filename), 'utf-8')
    expect(raw).toContain('From raw')
  })

  it('increments counter across writes', async () => {
    await writeFeedbackIssue(brainHome, { type: 'feature', title: 'A', summary: 's' })
    await writeFeedbackIssue(brainHome, { type: 'feature', title: 'B', summary: 's' })
    const list = await listFeedbackIssues(brainHome)
    const ids = list.map(i => i.id).sort((a, b) => a - b)
    expect(ids).toEqual([1, 2])
  })

  it('rejects file names that do not match pattern', async () => {
    const dir = brainLayoutIssuesDir(brainHome)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'junk.md'), 'x', 'utf-8')
    const list = await listFeedbackIssues(brainHome)
    expect(list).toHaveLength(0)
  })

  it('submitFeedbackMarkdown stores issue and wiki/feedback page (single-tenant)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'fb-wiki-'))
    try {
      const md = `---
type: bug
title: Wiki ref
---
## Summary

x`
      let outId = 0
      await runWithTenantContextAsync(
        { tenantUserId: '_single', workspaceHandle: '_single', homeDir: home },
        async () => {
          const out = await submitFeedbackMarkdown(md)
          outId = out.id
        },
      )
      const wikiP = join(brainLayoutWikiDir(home), 'feedback', `issue-${outId}.md`)
      const raw = await readFile(wikiP, 'utf-8')
      expect(raw).toContain('Wiki ref')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('submitFeedbackMarkdown (MT) writes .global, tenant issues copy, and wiki', async () => {
    const prevRoot = process.env.BRAIN_DATA_ROOT
    const root = await mkdtemp(join(tmpdir(), 'mt-fb-sub-'))
    const tid = 'usr_mt_fb_test'
    process.env.BRAIN_DATA_ROOT = root
    delete process.env.BRAIN_HOME
    ensureTenantHomeDir(tid)
    const md = '---\ntype: bug\ntitle: T\n---\n\nb'
    let outPath = ''
    await runWithTenantContextAsync(
      { tenantUserId: tid, workspaceHandle: 'h', homeDir: tenantHomeDir(tid) },
      async () => {
        const out = await submitFeedbackMarkdown(md)
        outPath = out.path
        expect(out.id).toBe(1)
        expect(out.path.startsWith(join(root, '.global'))).toBe(true)
      },
    )
    const tPath = join(brainLayoutIssuesDir(tenantHomeDir(tid)), basename(outPath))
    const gText = await readFile(outPath, 'utf-8')
    const tText = await readFile(tPath, 'utf-8')
    expect(gText).toBe(tText)
    expect(tText).toContain('reporter:')
    expect(tText).toContain(tid)
    const wikiP = join(brainLayoutWikiDir(tenantHomeDir(tid)), 'feedback', 'issue-1.md')
    const w = await readFile(wikiP, 'utf-8')
    expect(w).toContain('title: T')
    const globalList = await listFeedbackIssues(join(root, '.global'))
    expect(globalList).toHaveLength(1)
    const tenantList = await listFeedbackIssues(tenantHomeDir(tid))
    expect(tenantList).toHaveLength(1)

    await rm(root, { recursive: true, force: true })
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
  })
})
