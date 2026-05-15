/**
 * Writes `eval/tasks/b2b-research-v1.jsonl`: B2B **research agent only** (no privacy filter).
 *
 * Expectations are intentionally **minimal**: mail-backed cases assert that read tools ran; one case
 * asserts in-thread recall (grant history). **No** plumbing, anti-fluff, or disclosure checks here—
 * those belong to {@link filterB2BResponse} and the slim E2E suite (`eval:b2b:e2e`, `b2b-e2e.jsonl`).
 *
 * Run: npx tsx --tsconfig tsconfig.server.json src/server/evals/generateB2bResearchJsonl.ts
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBuiltinPolicyBodiesFromDisk } from '@server/lib/brainQuery/builtinPolicyBodiesFromDisk.js'
import type { B2BV1Task } from './harness/types.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const trusted = getBuiltinPolicyBodiesFromDisk().trusted

const creditQ =
  'Late 2001 indexed mail: name **two** factual themes tying Enron to credit or rating-agency chatter. **One short paragraph**, no bullet lists.'

const travelQ =
  'Steve — I am locking investor meetings in London next month. Did the charter desk say a nonstop out of Houston is doable on the large-cabin jet they quoted us (GV-class), or are we looking at a fuel stop?'

const tasks: B2BV1Task[] = [
  {
    id: 'b2b-research-001-lay-priorities',
    asker: 'kean',
    owner: 'lay',
    userMessage:
      "Ken Lay's priorities in late 2001 — from indexed mail only. **At most 3 bullets**, one sentence each; no preamble.",
    expect: {
      all: [{ kind: 'toolNamesIncludeOneOf', names: ['search_index', 'read_mail_message'] }],
    },
  },
  {
    id: 'b2b-research-002-lay-grant-history',
    asker: 'kean',
    owner: 'lay',
    privacyPolicy:
      'Answer briefly using only the prior conversation in this thread; do not search mail or wiki unless the question cannot be answered from that context.',
    grantHistory: [
      { role: 'user', content: 'For continuity: the secret handle is BLUEBIRD.' },
      { role: 'assistant', content: 'Understood; BLUEBIRD is the handle to remember.' },
    ],
    userMessage:
      'What exact one-word secret handle did we establish? Reply with that single word in ALL CAPS, nothing else.',
    expect: {
      all: [{ kind: 'finalTextIncludes', substring: 'BLUEBIRD', caseInsensitive: true }],
    },
  },
  {
    id: 'b2b-research-003-kean-credit',
    asker: 'lay',
    owner: 'kean',
    userMessage: creditQ,
    privacyPolicy: trusted,
    expect: {
      all: [
        {
          kind: 'toolNamesIncludeOneOf',
          names: ['search_index', 'read_mail_message', 'read_indexed_file'],
        },
      ],
    },
  },
  {
    id: 'b2b-research-004-kean-travel',
    asker: 'lay',
    owner: 'kean',
    userMessage: travelQ,
    privacyPolicy: trusted,
    expect: {
      all: [
        {
          kind: 'toolNamesIncludeOneOf',
          names: ['search_index', 'read_mail_message', 'read_indexed_file'],
        },
      ],
    },
  },
]

const out = join(repoRoot, 'eval/tasks/b2b-research-v1.jsonl')
const header =
  '# B2B research-agent only (draft scored; privacy filter skipped). Tool/thread checks only—no plumbing or disclosure asserts.\n' +
  '# Regenerate: npx tsx --tsconfig tsconfig.server.json src/server/evals/generateB2bResearchJsonl.ts\n' +
  '# Run: npm run eval:b2b-research\n'
writeFileSync(out, header + tasks.map(t => JSON.stringify(t)).join('\n') + '\n')
console.log('wrote', out)
