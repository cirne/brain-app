import { describe, expect, it } from 'vitest'
import {
  assertAgentReadPathAllowed,
  ripmailReadIdLooksLikeFilesystemPath,
} from './agentToolPolicy.js'

describe('agentToolPolicy surface', () => {
  it('rejects paths outside allowlist', async () => {
    await expect(assertAgentReadPathAllowed('../../../etc/passwd')).rejects.toThrow()
  })

  it('ripmailReadIdLooksLikeFilesystemPath flags path-like ids', () => {
    expect(ripmailReadIdLooksLikeFilesystemPath('/abs/path')).toBe(true)
    expect(ripmailReadIdLooksLikeFilesystemPath('C:\\\\Users\\\\x')).toBe(true)
    expect(ripmailReadIdLooksLikeFilesystemPath('<abc@mail.com>')).toBe(false)
  })
})
