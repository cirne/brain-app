/**
 * Regression for vault-root `index.md` missing while other pages exist: the cleanup agent’s
 * `read` / `edit` tools open files on disk — the user-facing error was:
 * `ENOENT: no such file or directory, open '…/data/wiki/index.md'`.
 *
 * `ensureWikiIndexMdStub` (via `ensureWikiVaultScaffoldForBuildout` before each lap) must always
 * run; account-holder skeleton failure must not skip the index stub.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentTools } from './tools.js'
import { buildCreateAgentToolsOptions, WIKI_CLEANUP_OMIT } from './agentToolSets.js'
import { joinToolResultText } from './agentTestUtils.js'
import { ensureWikiIndexMdStub } from '@server/lib/wiki/wikiIndexStub.js'

let testRoot: string
let wikiRoot: string

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'wiki-missing-index-'))
  wikiRoot = join(testRoot, 'wiki')
  await mkdir(join(wikiRoot, 'topics'), { recursive: true })
  await writeFile(join(wikiRoot, 'me.md'), '# Me\n', 'utf-8')
  await writeFile(join(wikiRoot, 'topics', 'a.md'), '# A\n', 'utf-8')
})

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

function cleanupStyleTools() {
  const toolOpts = buildCreateAgentToolsOptions({ extraOmit: WIKI_CLEANUP_OMIT })
  return createAgentTools(wikiRoot, toolOpts)
}

describe('missing vault index.md (cleanup / Your Wiki tool errors)', () => {
  it('reproduces ENOENT when read targets index.md before the stub exists', async () => {
    await expect(readFile(join(wikiRoot, 'index.md'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })

    const tools = cleanupStyleTools()
    const read = tools.find((t) => t.name === 'read')!
    await expect(read.execute('read-missing-index', { path: 'index.md' })).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('after ensureWikiIndexMdStub, read returns hub markdown (regression: stub must run every lap)', async () => {
    await ensureWikiIndexMdStub(wikiRoot)
    const tools = cleanupStyleTools()
    const read = tools.find((t) => t.name === 'read')!
    const result = await read.execute('read-after-stub', { path: 'index.md' })
    const text = joinToolResultText(result)
    expect(text).toContain('# Home')
    expect(text).toContain('[[me]]')
  })
})
