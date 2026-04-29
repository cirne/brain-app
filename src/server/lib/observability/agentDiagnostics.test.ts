import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core'

import {
  AGENT_DIAGNOSTICS_SCHEMA_VERSION,
  shouldWriteAgentDiagnostics,
  serializeAgentEventForDiagnostics,
  attachAgentDiagnosticsCollector,
} from './agentDiagnostics.js'

function parseJsonl(text: string): unknown[] {
  return text
    .trimEnd()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown)
}

describe('agentDiagnostics', () => {
  let prevNodeEnv: string | undefined
  let brainHome: string

  beforeEach(async () => {
    prevNodeEnv = process.env.NODE_ENV
    brainHome = await mkdtemp(join(tmpdir(), 'agent-diag-'))
    process.env.BRAIN_HOME = brainHome
  })

  afterEach(async () => {
    process.env.NODE_ENV = prevNodeEnv
    delete process.env.BRAIN_HOME
    await rm(brainHome, { recursive: true, force: true }).catch(() => {})
  })

  it('shouldWriteAgentDiagnostics is false in production', () => {
    process.env.NODE_ENV = 'production'
    expect(shouldWriteAgentDiagnostics()).toBe(false)
  })

  it('shouldWriteAgentDiagnostics is true outside production', () => {
    process.env.NODE_ENV = 'development'
    expect(shouldWriteAgentDiagnostics()).toBe(true)
    process.env.NODE_ENV = 'test'
    expect(shouldWriteAgentDiagnostics()).toBe(true)
  })

  it('serializeAgentEventForDiagnostics truncates large tool result', () => {
    const big = 'x'.repeat(120_000)
    const ev = {
      type: 'tool_execution_end' as const,
      toolCallId: 't1',
      toolName: 'search_index',
      result: { stdout: big },
      isError: false,
    }
    const row = serializeAgentEventForDiagnostics(ev)
    expect(JSON.stringify(row).length).toBeLessThan(big.length)
    const r = row.result as { stdout: string }
    expect(r.stdout.length).toBeLessThan(big.length)
  })

  it('attachAgentDiagnosticsCollector writes JSONL on agent_end', async () => {
    process.env.NODE_ENV = 'development'

    let listener: Parameters<Agent['subscribe']>[0] | undefined
    const agent = {
      subscribe(fn: Parameters<Agent['subscribe']>[0]) {
        listener = fn
        return () => {
          listener = undefined
        }
      },
    } as Agent

    const unsub = attachAgentDiagnosticsCollector(agent, {
      agentTurnId: 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
      agentKind: 'test_harness',
      source: 'agent_diagnostics_test',
      sessionId: 'sess-xs',
    })
    expect(listener).toBeTypeOf('function')

    const endEv: AgentEvent = { type: 'agent_end', messages: [] }
    await listener!(endEv, new AbortController().signal)
    unsub()

    const diagDir = join(brainHome, 'var', 'agent-diagnostics')
    const files = await readdir(diagDir)
    expect(files.some((f) => f.endsWith('.jsonl'))).toBe(true)
    const jl = files.find((f) => f.endsWith('.jsonl'))!
    const raw = await readFile(join(diagDir, jl), 'utf-8')
    const objs = parseJsonl(raw)
    expect(objs.length).toBeGreaterThanOrEqual(3)
    const head = objs[0] as { kind: string; schemaVersion: number; meta: { agentTurnId: string } }
    expect(head.kind).toBe('diag_header')
    expect(head.schemaVersion).toBe(AGENT_DIAGNOSTICS_SCHEMA_VERSION)
    expect(head.meta.agentTurnId).toBe('aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee')
    const last = objs[objs.length - 1] as {
      kind: string
      summary: { durationMs: number; toolCallCount: number }
    }
    expect(last.kind).toBe('diag_footer')
    expect(last.summary.toolCallCount).toBe(0)
    expect(last.summary.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('attachAgentDiagnosticsCollector is a no-op in production', () => {
    process.env.NODE_ENV = 'production'
    let subscribed = false
    const agent = {
      subscribe() {
        subscribed = true
        return () => {}
      },
    } as unknown as Agent
    attachAgentDiagnosticsCollector(agent, {
      agentTurnId: 'id',
      agentKind: 'test',
      source: 't',
    })()
    expect(subscribed).toBe(false)
  })
})
