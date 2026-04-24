import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkExpect } from './checkExpect.js'
import { loadEnronV1TasksFromFile } from './loadJsonlEvalTasks.js'
import { getEvalRepoRoot } from './runLlmJsonlEval.js'

const root = getEvalRepoRoot()
const taskFile = join(root, 'eval', 'tasks', 'enron-v1.jsonl')

describe('enron-v1 task file', () => {
  it('getEvalRepoRoot() resolves the repo (same layout as Enron/wiki JSONL eval CLIs)', () => {
    expect(existsSync(join(root, 'package.json'))).toBe(true)
    expect(existsSync(taskFile)).toBe(true)
  })
  it('loads cases with id and userMessage', async () => {
    const tasks = await loadEnronV1TasksFromFile(taskFile)
    expect(tasks.length).toBeGreaterThan(0)
    for (const t of tasks) {
      expect(t.id).toMatch(/^enron-/)
      expect(t.userMessage.length).toBeGreaterThan(10)
      expect(t.expect).toBeDefined()
    }
  })
  it('no-hit tasks accept ripmail totalMatched (pretty or minified)', async () => {
    const tasks = await loadEnronV1TasksFromFile(taskFile)
    const pretty = '{\n  "results": [],\n  "totalMatched": 0\n}\n'
    const minified = '{"results":[],"totalMatched":0}'
    for (const id of ['enron-004-no-hit-xyzzy', 'enron-010-no-hit-zzz'] as const) {
      const t = tasks.find((x) => x.id === id)
      expect(t, id).toBeDefined()
      for (const toolJson of [pretty, minified]) {
        const r = checkExpect(t!.expect, '', toolJson, [])
        expect(r.ok, `${id} ${toolJson.slice(0, 40)}… → ${r.reasons.join('; ')}`).toBe(true)
      }
    }
  })
})

describe('checkExpect', () => {
  it('toolResultIncludes passes when haystack has substring', () => {
    const r = checkExpect(
      { kind: 'toolResultIncludes', substring: 'abc' },
      '',
      'foo abc bar',
      [],
    )
    expect(r.ok).toBe(true)
  })
  it('finalTextIncludesOneOf is case-insensitive when requested', () => {
    const r = checkExpect(
      { kind: 'finalTextIncludesOneOf', substrings: ['Dubuque'], caseInsensitive: true },
      'I went to DUBUQUE',
      '',
      [],
    )
    expect(r.ok).toBe(true)
  })
  it('any branch passes if one matches', () => {
    const r = checkExpect(
      { any: [{ kind: 'toolResultIncludes', substring: 'nope' }, { kind: 'toolResultIncludes', substring: 'yes' }] },
      '',
      'yes',
      [],
    )
    expect(r.ok).toBe(true)
  })
  it('toolNamesIncludeAll requires each tool name', () => {
    const r = checkExpect({ kind: 'toolNamesIncludeAll', names: ['read', 'grep'] }, '', '', ['grep', 'read', 'edit'])
    expect(r.ok).toBe(true)
  })
})
