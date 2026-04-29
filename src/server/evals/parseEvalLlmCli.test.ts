import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvalCliParsedValues, extractBrainWikiRootFromArgv } from './parseEvalLlmCli.js'

describe('extractBrainWikiRootFromArgv', () => {
  it('reads --brain-wiki-root value (parseArgs does not bind this key)', () => {
    expect(
      extractBrainWikiRootFromArgv([
        'node',
        'tsx',
        '--tsconfig',
        'tsconfig.server.json',
        'wikiV1cli.ts',
        '--id',
        'x',
        '--brain-wiki-root',
        '/tmp/wiki-parent',
      ]),
    ).toBe('/tmp/wiki-parent')
  })

  it('reads --brainWikiRoot value', () => {
    expect(extractBrainWikiRootFromArgv(['node', 'cli.js', '--brainWikiRoot', '/abs/z'])).toBe('/abs/z')
  })

  it('reads equals form', () => {
    expect(extractBrainWikiRootFromArgv(['--brain-wiki-root=/eq/path'])).toBe('/eq/path')
  })
})

describe('applyEvalCliParsedValues', () => {
  const keys = ['LLM_PROVIDER', 'LLM_MODEL', 'EVAL_CASE_ID', 'BRAIN_WIKI_ROOT'] as const
  let prev: Partial<Record<(typeof keys)[number], string | undefined>> = {}

  beforeEach(() => {
    prev = {}
    for (const k of keys) {
      prev[k] = process.env[k]
    }
  })

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  })

  it('sets BRAIN_WIKI_ROOT and resolves relative path', () => {
    delete process.env.BRAIN_WIKI_ROOT
    applyEvalCliParsedValues({ brainWikiRoot: './relative-wiki-parent' })
    expect(process.env.BRAIN_WIKI_ROOT).toBe(resolve(process.cwd(), 'relative-wiki-parent'))
  })

  it('overrides existing BRAIN_WIKI_ROOT', () => {
    process.env.BRAIN_WIKI_ROOT = '/old/path'
    applyEvalCliParsedValues({ brainWikiRoot: '/new/path' })
    expect(process.env.BRAIN_WIKI_ROOT).toBe(resolve('/new/path'))
  })
})
