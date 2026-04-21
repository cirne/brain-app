import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { postVaultDeleteAllData, postVaultUnlock } from './vaultClient.js'

describe('postVaultUnlock', () => {
  let fetchSpy: MockInstance<typeof fetch>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('sends password only when workspaceHandle omitted', async () => {
    await postVaultUnlock('secret')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ password: 'secret' })
  })

  it('includes trimmed workspaceHandle when provided', async () => {
    await postVaultUnlock('secret', { workspaceHandle: '  my-workspace  ' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      password: 'secret',
      workspaceHandle: 'my-workspace',
    })
  })
})

describe('postVaultDeleteAllData', () => {
  let fetchSpy: MockInstance<typeof fetch>

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('POSTs /api/vault/delete-all-data', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const out = await postVaultDeleteAllData()
    expect(out).toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledWith('/api/vault/delete-all-data', { method: 'POST' })
  })

  it('returns error body on failure', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'No.' }), { status: 401 }),
    )
    const out = await postVaultDeleteAllData()
    expect(out).toEqual({ error: 'No.' })
  })
})
