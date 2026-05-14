import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkExpect } from './checkExpect.js'
import { loadEnronV1TasksFromFile } from './loadJsonlEvalTasks.js'
import { getEvalRepoRoot } from './runLlmJsonlEval.js'

const root = getEvalRepoRoot()
const taskFile = join(root, 'eval', 'tasks', 'mail-compose-v1.jsonl')

describe('mail-compose-v1 task file', () => {
  it('exists next to enron-v1.jsonl', () => {
    expect(existsSync(taskFile)).toBe(true)
  })

  it('loads cases with compose- ids', async () => {
    const tasks = await loadEnronV1TasksFromFile(taskFile)
    expect(tasks.length).toBeGreaterThanOrEqual(4)
    for (const t of tasks) {
      expect(t.id).toMatch(/^compose-/)
      expect(t.userMessage.length).toBeGreaterThan(20)
      expect(t.expect).toBeDefined()
    }
  })

  it('compose-002: synthetic draft tool text passes (new mail to Janet)', async () => {
    const tasks = await loadEnronV1TasksFromFile(taskFile)
    const t = tasks.find((x) => x.id === 'compose-002-new-to-janet-weekly-question')
    expect(t).toBeDefined()
    const toolHaystack = [
      'Draft is saved in the app.',
      'Draft id: draft_eval_test',
      'Subject: Weekly reports question',
      'To: janet.butler@enron.com',
    ].join('\n')
    const r = await checkExpect(t!.expect, '(ack)', toolHaystack, ['draft_email'])
    expect(r.ok, r.reasons.join('; ')).toBe(true)
  })

  it('compose-001: report-shaped Shapiro reply passes tightened expects', async () => {
    const tasks = await loadEnronV1TasksFromFile(taskFile)
    const t = tasks.find((x) => x.id === 'compose-001-reply-shapiro-my-thoughts')
    expect(t).toBeDefined()
    const haystack = [
      '{"messageId":"15323857.1075855428713.JavaMail.evans@thyme","date":"2001-11-30T22:50:58.000Z"}',
      'Draft is saved in the app.',
      'Draft id: 5365205c-01de-4bfb-b543-f1077b4eda49',
      'Subject: Re: My Thoughts',
      'To: richard.shapiro@enron.com, stacey.bolton@enron.com',
    ].join('\n')
    const r = await checkExpect(t!.expect, 'Draft created.', haystack, [
      'search_index',
      'draft_email',
      'suggest_reply_options',
    ])
    expect(r.ok, r.reasons.join('; ')).toBe(true)
  })
})
