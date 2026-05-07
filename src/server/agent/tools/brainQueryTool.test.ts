import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createBrainQueryTool } from './brainQueryTool.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { tenantHomeDir, ensureTenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import * as runBrainQueryMod from '@server/lib/brainQuery/runBrainQuery.js'

vi.mock('@server/lib/brainQuery/runBrainQuery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof runBrainQueryMod>()
  return { ...actual, runBrainQuery: vi.fn(actual.runBrainQuery) }
})

const runBrainQueryMock = vi.mocked(runBrainQueryMod.runBrainQuery)

const testToolCtx = {} as ExtensionContext

describe('ask_brain tool', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  let root: string
  const askerId = 'usr_11111111111111111111'
  const ownerId = 'usr_22222222222222222222'

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await mkdtemp(join(tmpdir(), 'ask-brain-tool-'))
    process.env.BRAIN_DATA_ROOT = root
    ensureTenantHomeDir(askerId)
    ensureTenantHomeDir(ownerId)
    await writeHandleMeta(tenantHomeDir(ownerId), {
      userId: ownerId,
      handle: 'donna',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  afterEach(async () => {
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
    else delete process.env.BRAIN_DATA_ROOT
    await rm(root, { recursive: true, force: true })
  })

  async function exec(toolCallId: string, params: { target_handle: string; question: string }) {
    const tool = createBrainQueryTool()
    return tool.execute(toolCallId, params, undefined, undefined, testToolCtx)
  }

  it('returns filtered answer when runBrainQuery ok', async () => {
    runBrainQueryMock.mockResolvedValue({
      ok: true,
      answer: 'Status: on track.',
      logId: 'x',
    })
    const out = await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'alice', homeDir: tenantHomeDir(askerId) },
      () =>
        exec('tc1', {
          target_handle: 'donna',
          question: 'project?',
        }),
    )
    const text = out.content[0]
    expect(text && 'text' in text && typeof text.text === 'string' ? text.text : '').toContain('on track')
    expect(runBrainQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        askerId,
        question: 'project?',
      }),
    )
  })

  it('surfaces denied_no_grant politely', async () => {
    runBrainQueryMock.mockResolvedValue({
      ok: false,
      code: 'denied_no_grant',
      message: 'Nope',
      logId: 'y',
    })
    const out = await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'alice', homeDir: tenantHomeDir(askerId) },
      () => exec('tc2', { target_handle: '@donna', question: 'anything' }),
    )
    const text = out.content[0]
    expect(text && 'text' in text ? text.text : '').toMatch(/Settings.*Brain queries/i)
  })
})
