import { describe, expect, it, vi } from 'vitest'
import { WIKI_LAP_PLAN_CAP } from '@shared/wikiLap.js'

/** Deterministic validate tests: without this, a local ripmail DB strips fake ids and cap checks flip to idle. */
vi.mock('@server/ripmail/db.js', () => ({
  openRipmailDb: vi.fn(() => {
    throw new Error('wikiLapPlan.test: no ripmail')
  }),
  closeRipmailDb: vi.fn(),
}))
import {
  collectPlanTargetPaths,
  evidenceIdsByPathFromPlan,
  formatPlanForExecutePrompt,
  isAllowedPlanWritePath,
  normalizeWikiLapPlan,
  parseWikiLapPlanFromModelText,
  validateAndSanitizeWikiLapPlan,
  writeAllowlistFromPlan,
} from './wikiLapPlan.js'

describe('isAllowedPlanWritePath', () => {
  it('allows typed markdown paths', () => {
    expect(isAllowedPlanWritePath('people/alice.md')).toBe(true)
    expect(isAllowedPlanWritePath('topics/foo.md')).toBe(true)
  })
  it('rejects index, me, assistant, and non-md', () => {
    expect(isAllowedPlanWritePath('index.md')).toBe(false)
    expect(isAllowedPlanWritePath('me.md')).toBe(false)
    expect(isAllowedPlanWritePath('assistant.md')).toBe(false)
    expect(isAllowedPlanWritePath('people/foo.txt')).toBe(false)
    expect(isAllowedPlanWritePath('other/x.md')).toBe(false)
  })
})

describe('normalizeWikiLapPlan', () => {
  it('drops newPages with bad path or missing evidence', () => {
    const p = normalizeWikiLapPlan({
      idle: false,
      reasoning: 'r',
      newPages: [
        { path: 'me.md', kind: 'x', evidenceSummary: 's', evidenceMessageIds: ['1'] },
        { path: 'topics/ok.md', kind: 't', evidenceSummary: '', evidenceMessageIds: ['1'] },
        { path: 'topics/ok.md', kind: 't', evidenceSummary: 's', evidenceMessageIds: [] },
        { path: 'topics/good.md', kind: 't', evidenceSummary: 'sum', evidenceMessageIds: ['mid'] },
      ],
      deepens: [],
      refreshes: [],
      skipped: [],
    })
    expect(p).not.toBeNull()
    expect(p!.newPages.map((x) => x.path)).toEqual(['topics/good.md'])
  })
})

describe('parseWikiLapPlanFromModelText', () => {
  it('parses fenced json', () => {
    const text = 'Hi\n```json\n{"idle":true,"reasoning":"x","newPages":[],"deepens":[],"refreshes":[],"skipped":[]}\n```'
    const p = parseWikiLapPlanFromModelText(text)
    expect(p?.idle).toBe(true)
  })
  it('parses bare object', () => {
    const text = 'prefix {"idle":false,"reasoning":"z","newPages":[],"deepens":[],"refreshes":[],"skipped":[]} trailing'
    const p = parseWikiLapPlanFromModelText(text)
    expect(p?.idle).toBe(false)
    expect(p?.reasoning).toBe('z')
  })
})

describe('validateAndSanitizeWikiLapPlan', () => {
  it('idle plan clears work arrays', () => {
    const v = validateAndSanitizeWikiLapPlan({
      idle: true,
      reasoning: 'done',
      newPages: [{ path: 'topics/x.md', kind: 't', evidenceSummary: 's', evidenceMessageIds: ['1'] }],
      deepens: [
        {
          path: 'topics/y.md',
          currentGaps: [],
          indexSignals: 'sig',
          evidenceMessageIds: ['1'],
        },
      ],
      refreshes: [{ path: 'topics/z.md', staleClaim: 'c', evidenceMessageIds: ['1'] }],
      skipped: [],
    })
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.plan.newPages).toEqual([])
      expect(v.plan.deepens).toEqual([])
      expect(v.plan.refreshes).toEqual([])
    }
  })

  it('fails when work item count exceeds cap', () => {
    const newPages = Array.from({ length: WIKI_LAP_PLAN_CAP + 1 }, (_, i) => ({
      path: `topics/p${i}.md`,
      kind: 't',
      evidenceSummary: `s${i}`,
      evidenceMessageIds: [`id${i}`],
    }))
    const v = validateAndSanitizeWikiLapPlan({
      idle: false,
      reasoning: 'too much',
      newPages,
      deepens: [],
      refreshes: [],
      skipped: [],
    })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toContain('cap')
  })
})

describe('plan helpers', () => {
  const plan = normalizeWikiLapPlan({
    idle: false,
    reasoning: 'why',
    newPages: [{ path: 'Topics/Foo.md', kind: 't', evidenceSummary: 's', evidenceMessageIds: ['a'] }],
    deepens: [
      {
        path: 'people/bar.md',
        currentGaps: ['g'],
        indexSignals: 'sig',
        evidenceMessageIds: ['b'],
      },
    ],
    refreshes: [{ path: 'notes/z.md', staleClaim: 'old', evidenceMessageIds: ['c'] }],
    skipped: [],
  })!
  it('writeAllowlist lowercases paths', () => {
    expect([...writeAllowlistFromPlan(plan)]).toEqual(['topics/foo.md'])
  })
  it('collectPlanTargetPaths dedupes and sorts', () => {
    expect(collectPlanTargetPaths(plan)).toEqual(['Topics/Foo.md', 'notes/z.md', 'people/bar.md'])
  })
  it('evidenceIdsByPathFromPlan maps normalized keys', () => {
    const m = evidenceIdsByPathFromPlan(plan)
    expect(m.get('topics/foo.md')).toEqual(['a'])
    expect(m.get('people/bar.md')).toEqual(['b'])
  })
  it('formatPlanForExecutePrompt includes sections', () => {
    const s = formatPlanForExecutePrompt(plan)
    expect(s).toContain('Wiki lap plan')
    expect(s).toContain('### New pages')
    expect(s).toContain('Topics/Foo.md')
  })
})
