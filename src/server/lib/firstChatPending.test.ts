import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'first-chat-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('firstChatPending', () => {
  it('tryConsumeFirstChatPending returns false when no file', async () => {
    const { tryConsumeFirstChatPending } = await import('./firstChatPending.js')
    expect(await tryConsumeFirstChatPending()).toBe(false)
  })

  it('write then consume returns true once', async () => {
    const { writeFirstChatPending, tryConsumeFirstChatPending } = await import('./firstChatPending.js')
    await writeFirstChatPending()
    expect(await tryConsumeFirstChatPending()).toBe(true)
    expect(await tryConsumeFirstChatPending()).toBe(false)
  })

  it('hasFirstChatPending is true iff file exists', async () => {
    const { hasFirstChatPending, writeFirstChatPending, tryConsumeFirstChatPending } = await import(
      './firstChatPending.js'
    )
    expect(await hasFirstChatPending()).toBe(false)
    await writeFirstChatPending()
    expect(await hasFirstChatPending()).toBe(true)
    await tryConsumeFirstChatPending()
    expect(await hasFirstChatPending()).toBe(false)
  })
})
