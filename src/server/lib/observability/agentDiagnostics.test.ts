import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AssistantMessageEvent } from '@mariozechner/pi-ai'
import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core'

import {
  AGENT_DIAGNOSTICS_SCHEMA_VERSION,
  shouldWriteAgentDiagnostics,
  serializeAgentEventForDiagnostics,
  attachAgentDiagnosticsCollector,
  writeSyntheticTurnDiagnosticsJsonl,
} from './agentDiagnostics.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { generateUserId } from '@server/lib/tenant/handleMeta.js'

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
  let tenantUid: string

  beforeEach(async () => {
    prevNodeEnv = process.env.NODE_ENV
    brainHome = await mkdtemp(join(tmpdir(), 'agent-diag-'))
    tenantUid = generateUserId()
    delete process.env.BRAIN_HOME
  })

  afterEach(async () => {
    process.env.NODE_ENV = prevNodeEnv
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
    await runWithTenantContextAsync(
      { tenantUserId: tenantUid, workspaceHandle: 'diag-test', homeDir: brainHome },
      async () => {
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
          toolTrace: unknown[]
        }
        expect(last.kind).toBe('diag_footer')
        expect(Array.isArray(last.toolTrace)).toBe(true)
        expect(last.toolTrace).toEqual([])
        expect(last.summary.toolCallCount).toBe(0)
        expect(last.summary.durationMs).toBeGreaterThanOrEqual(0)
      },
    )
  })

  it('writeSyntheticTurnDiagnosticsJsonl writes JSONL with toolTrace and arbitrary transcript', async () => {
    await runWithTenantContextAsync(
      { tenantUserId: tenantUid, workspaceHandle: 'diag-synthetic', homeDir: brainHome },
      async () => {
        process.env.NODE_ENV = 'development'

        const path = await writeSyntheticTurnDiagnosticsJsonl({
          meta: {
            agentTurnId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
            agentKind: 'finish_conversation_shortcut',
            source: 'chat_sse_finish_shortcut',
            sessionId: 'sess-finish',
          },
          fileKind: 'finish_conversation_shortcut',
          durationMs: 15,
          toolTrace: [
            {
              toolCallId: 'tool-fc-1',
              toolName: 'finish_conversation',
              isError: false,
              durationMs: 0,
              argsJsonBytes: 2,
              resultJsonBytes: 60,
              resultTruncated: false,
              resultSha256: 'abc',
              resultPreview: 'ok',
            },
          ],
          transcript: { shortcut: true, sseEmittedDone: true, extra: { note: 'any shape' } },
          events: [
            {
              kind: 'event' as const,
              seq: 1,
              type: 'tool_execution_end',
              toolCallId: 'tool-fc-1',
              toolName: 'finish_conversation',
              isError: false,
              result: 'x',
            },
          ],
        })
        expect(path).toBeTypeOf('string')
        expect(path!.endsWith('_finish_conversation_shortcut.jsonl')).toBe(true)

        const raw = await readFile(path!, 'utf-8')
        const objs = parseJsonl(raw)
        expect(objs.length).toBe(3)
        const head = objs[0] as { kind: string; meta: { agentKind: string; source: string } }
        expect(head.meta.agentKind).toBe('finish_conversation_shortcut')
        expect(head.meta.source).toBe('chat_sse_finish_shortcut')
        const foot = objs[2] as {
          kind: string
          toolTrace: { toolName: string }[]
          transcript: { shortcut?: boolean; extra?: { note: string } }
        }
        expect(foot.kind).toBe('diag_footer')
        expect(foot.toolTrace).toHaveLength(1)
        expect(foot.toolTrace[0].toolName).toBe('finish_conversation')
        expect(foot.transcript.shortcut).toBe(true)
        expect(foot.transcript.extra?.note).toBe('any shape')
      },
    )
  })

  it('attachAgentDiagnosticsCollector omits message_update and tool_execution_update lines', async () => {
    await runWithTenantContextAsync(
      { tenantUserId: tenantUid, workspaceHandle: 'diag-test', homeDir: brainHome },
      async () => {
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

        attachAgentDiagnosticsCollector(agent, {
          agentTurnId: 'bbbbbbbb-bbbb-4ccc-dddd-eeeeeeeeeeee',
          agentKind: 'omit_stream_test',
          source: 'agent_diagnostics_test',
        })
        const ac = new AbortController()
        const assistantMsg = {
          role: 'assistant',
          content: [],
          api: 'test',
          provider: 'test',
          model: 'm',
        } as unknown as AgentMessage
        await listener!(
          {
            type: 'message_update',
            message: assistantMsg,
            assistantMessageEvent: {} as AssistantMessageEvent,
          } as AgentEvent,
          ac.signal,
        )
        await listener!(
          {
            type: 'tool_execution_update',
            toolCallId: 'c1',
            toolName: 't',
            args: {},
            partialResult: {},
          } as AgentEvent,
          ac.signal,
        )
        await listener!({ type: 'agent_end', messages: [] }, ac.signal)

        const diagDir = join(brainHome, 'var', 'agent-diagnostics')
        const raw = await readFile(join(diagDir, (await readdir(diagDir)).find((f) => f.endsWith('.jsonl'))!), 'utf-8')
        expect(raw.includes('message_update')).toBe(false)
        expect(raw.includes('tool_execution_update')).toBe(false)
        const objs = parseJsonl(raw)
        const events = objs.filter((o) => (o as { kind?: string }).kind === 'event') as { type: string }[]
        expect(events.map((e) => e.type)).toEqual(['agent_end'])
      },
    )
  })

  it('attachAgentDiagnosticsCollector footer toolTrace matches tool_execution_*', async () => {
    await runWithTenantContextAsync(
      { tenantUserId: tenantUid, workspaceHandle: 'diag-test', homeDir: brainHome },
      async () => {
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

        attachAgentDiagnosticsCollector(agent, {
          agentTurnId: 'cccccccc-bbbb-4ccc-dddd-eeeeeeeeeeee',
          agentKind: 'tool_trace_test',
          source: 'agent_diagnostics_test',
        })
        const ac = new AbortController()
        await listener!(
          {
            type: 'tool_execution_start',
            toolCallId: 'tc-1',
            toolName: 'my_tool',
            args: { q: 'hi' },
          } as AgentEvent,
          ac.signal,
        )
        await listener!(
          {
            type: 'tool_execution_end',
            toolCallId: 'tc-1',
            toolName: 'my_tool',
            result: { ok: true, out: 'done' },
            isError: false,
          } as AgentEvent,
          ac.signal,
        )
        await listener!({ type: 'agent_end', messages: [] }, ac.signal)

        const diagDir = join(brainHome, 'var', 'agent-diagnostics')
        const jl = (await readdir(diagDir)).find((f) => f.endsWith('.jsonl'))!
        const objs = parseJsonl(await readFile(join(diagDir, jl), 'utf-8'))
        const last = objs[objs.length - 1] as { toolTrace: Array<{ toolCallId: string; toolName: string; resultTruncated: boolean }> }
        expect(last.toolTrace).toHaveLength(1)
        expect(last.toolTrace[0].toolCallId).toBe('tc-1')
        expect(last.toolTrace[0].toolName).toBe('my_tool')
        expect(last.toolTrace[0].resultTruncated).toBe(false)
        const toolEndLine = objs.find(
          (o) => (o as { type?: string }).type === 'tool_execution_end',
        ) as { result: { ok: boolean } }
        expect(toolEndLine.result.ok).toBe(true)
      },
    )
  })

  it('attachAgentDiagnosticsCollector spills large tool result to sidecar JSON', async () => {
    await runWithTenantContextAsync(
      { tenantUserId: tenantUid, workspaceHandle: 'diag-test', homeDir: brainHome },
      async () => {
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

        attachAgentDiagnosticsCollector(agent, {
          agentTurnId: 'dddddddd-bbbb-4ccc-dddd-eeeeeeeeeeee',
          agentKind: 'sidecar_test',
          source: 'agent_diagnostics_test',
        })
        const ac = new AbortController()
        const huge = 'y'.repeat(70_000)
        await listener!(
          {
            type: 'tool_execution_start',
            toolCallId: 'big-tool',
            toolName: 'blob',
            args: {},
          } as AgentEvent,
          ac.signal,
        )
        await listener!(
          {
            type: 'tool_execution_end',
            toolCallId: 'big-tool',
            toolName: 'blob',
            result: { payload: huge },
            isError: false,
          } as AgentEvent,
          ac.signal,
        )
        await listener!({ type: 'agent_end', messages: [] }, ac.signal)

        const diagDir = join(brainHome, 'var', 'agent-diagnostics')
        const files = await readdir(diagDir)
        expect(files.some((f) => f.includes('_tool_big-tool') && f.endsWith('.json'))).toBe(true)
        const jl = files.find((f) => f.endsWith('.jsonl'))!
        const objs = parseJsonl(await readFile(join(diagDir, jl), 'utf-8'))
        const toolLine = objs.find((o) => (o as { type?: string }).type === 'tool_execution_end') as {
          result: { ref: string; kind: string; bytes: number }
        }
        expect(toolLine.result.kind).toBe('diag_tool_sidecar')
        expect(typeof toolLine.result.ref).toBe('string')
        expect(toolLine.result.bytes).toBeGreaterThan(60_000)
        const sidePath = join(diagDir, toolLine.result.ref)
        const sideRaw = await readFile(sidePath, 'utf-8')
        const side = JSON.parse(sideRaw) as { result: { payload: string } }
        expect(side.result.payload.length).toBe(70_000)
        const last = objs[objs.length - 1] as { toolTrace: Array<{ sidecarRef?: string }> }
        expect(last.toolTrace[0].sidecarRef).toBe(toolLine.result.ref)
      },
    )
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
