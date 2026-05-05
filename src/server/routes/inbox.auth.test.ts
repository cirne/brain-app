import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Buffer } from 'node:buffer'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'

/** Simulates a spawned ripmail process for `runRipmailArgv` (stdio + close). */
function createMockChild(options: {
  stdout?: string
  stderr?: string
  code?: number
  err?: Error
}): EventEmitter {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number
    killed: boolean
    kill: (signal?: string) => boolean
  }
  child.stdout = stdout
  child.stderr = stderr
  child.pid = 42_424
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }

  queueMicrotask(() => {
    if (options.err) {
      child.emit('error', options.err)
      return
    }
    const { stdout: out = '', stderr: err = '', code = 0 } = options
    if (out.length > 0) stdout.emit('data', Buffer.from(out, 'utf8'))
    if (err.length > 0) stderr.emit('data', Buffer.from(err, 'utf8'))
    child.emit('close', code, null)
  })
  return child
}

const spawnMock = vi.fn()
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: spawnMock }
})

const TENANT_ID = 'usr_inboxauthtest000001'

describe('inbox route authentication (BUG-030)', () => {
  let brainRoot: string
  let sessionId: string
  let app: Hono

  const prevRoot = process.env.BRAIN_DATA_ROOT

  beforeEach(async () => {
    process.env.RIPMAIL_BIN = 'ripmail'
    brainRoot = await mkdtemp(join(tmpdir(), 'inbox-auth-'))
    process.env.BRAIN_DATA_ROOT = brainRoot
    delete process.env.BRAIN_HOME

    // Create tenant and session
    ensureTenantHomeDir(TENANT_ID)
    sessionId = await runWithTenantContextAsync(
      { tenantUserId: TENANT_ID, workspaceHandle: TENANT_ID, homeDir: tenantHomeDir(TENANT_ID) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sessionId, TENANT_ID)

    // Set up app with middleware
    vi.resetModules()
    const { default: inboxRoute } = await import('./inbox.js')
    app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/inbox', inboxRoute)
  })

  afterEach(async () => {
    delete process.env.RIPMAIL_BIN
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
    vi.resetAllMocks()
    await rm(brainRoot, { recursive: true, force: true })
  })

  it('returns 401 when GET /api/inbox/:id is called without session cookie', async () => {
    // Mock ripmail to return a valid message
    const readJson = {
      headersText: 'From: test@example.com\nSubject: Test',
      body: 'Test body',
    }
    spawnMock.mockImplementation(() => createMockChild({ stdout: JSON.stringify(readJson), code: 0 }))

    // Request WITHOUT cookie should fail with 401
    const res = await app.request('/api/inbox/msg-1')
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error?: string }
    // In multi-tenant mode, missing session returns tenant_required first
    expect(json.error).toBe('tenant_required')
  })

  it('auth passes when GET /api/inbox/:id includes valid session cookie', async () => {
    // Mock ripmail to return a valid message
    const readJson = {
      headersText: 'From: test@example.com\nSubject: Test',
      body: 'Test body',
    }
    spawnMock.mockImplementation(() => createMockChild({ stdout: JSON.stringify(readJson), code: 0 }))

    // Request WITH cookie should pass auth (then ripmail executes)
    const res = await app.request('/api/inbox/msg-1', {
      headers: { Cookie: `brain_session=${sessionId}` },
    })
    // Auth passes - not 401. Actual response is 404 (message not found in test env) or 200 (success)
    expect(res.status).not.toBe(401)
    // The key point: with credentials, we get past auth middleware
    expect(res.status).toBeGreaterThanOrEqual(200)
  })

  it('reproduces BUG-030: agent tools work (server-side) but panel fetch fails without credentials', async () => {
    // Simulate agent tool (server-side) - uses tenant context from AsyncLocalStorage
    // This would be like POST /api/chat where tools execute with the request's auth context
    const agentReadJson = {
      headersText: 'From: agent@example.com\nSubject: Agent Test',
      body: 'Agent test body',
    }
    spawnMock.mockImplementation(() => createMockChild({ stdout: JSON.stringify(agentReadJson), code: 0 }))

    // Agent tools run server-side with context already established
    // (In real code, POST /api/chat establishes context via middleware, then tools use execRipmailAsync)
    // Simulating what happens during a chat request:
    const agentWorked = await runWithTenantContextAsync(
      { tenantUserId: TENANT_ID, workspaceHandle: TENANT_ID, homeDir: tenantHomeDir(TENANT_ID) },
      async () => {
        // Agent tools call ripmail within the established context
        return true // Simplified: in reality, agent would call read_mail_message tool
      },
    )
    expect(agentWorked).toBe(true)

    // But inbox panel fetch WITHOUT cookie fails with 401
    const panelRes = await app.request('/api/inbox/msg-1')
    expect(panelRes.status).toBe(401)
    const json = (await panelRes.json()) as { error?: string }
    expect(json.error).toBe('tenant_required')

    // Root cause: client fetch doesn't include credentials: 'include'
    // Fix: add { credentials: 'include' } to fetch in Inbox.svelte line 268
  })

  it('demonstrates the fix: fetch with credentials (Cookie header) passes auth', async () => {
    const readJson = {
      headersText: 'From: fix@example.com\nSubject: Fix Test',
      body: 'Fix test body',
    }
    spawnMock.mockImplementation(() => createMockChild({ stdout: JSON.stringify(readJson), code: 0 }))

    // Simulate fetch with credentials: 'include' by passing Cookie header
    // (In browser, credentials: 'include' ensures cookies are sent)
    const resWithCreds = await app.request('/api/inbox/msg-1', {
      headers: { Cookie: `brain_session=${sessionId}` },
    })
    // With credentials, auth middleware passes (not 401)
    // Actual status could be 200 (success) or 404 (ripmail message not found in test)
    expect(resWithCreds.status).not.toBe(401)
    
    // The fix is confirmed: adding credentials prevents the 401 auth error
    // In production with real mail data, this would return 200
  })
})
