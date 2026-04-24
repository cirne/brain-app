import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getFeedbackIssueById,
  listFeedbackIssues,
  writeFeedbackIssue,
  writeFeedbackIssueFromMarkdown,
} from './feedbackIssues.js'
import { brainLayoutIssuesDir } from './brainLayout.js'

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
})
