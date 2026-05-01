import { describe, expect, it, vi, afterEach, type MockInstance } from 'vitest'
import { postVaultDeleteAllData } from './vaultClient.js'

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
