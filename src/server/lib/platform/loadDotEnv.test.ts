import { afterEach, describe, expect, it } from 'vitest'
import { enforceDataRootEnvPrecedence } from './loadDotEnv.js'

describe('enforceDataRootEnvPrecedence', () => {
  const snapshot: Record<string, string | undefined> = {}

  afterEach(() => {
    for (const k of Object.keys(snapshot)) {
      const v = snapshot[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  function capture(keys: string[]) {
    for (const k of keys) {
      snapshot[k] = process.env[k]
    }
  }

  it('clears BRAIN_HOME and BRAIN_WIKI_ROOT when BRAIN_DATA_ROOT is set', () => {
    capture(['BRAIN_DATA_ROOT', 'BRAIN_HOME', 'BRAIN_WIKI_ROOT'])
    process.env.BRAIN_DATA_ROOT = '/mnt/brain-data'
    process.env.BRAIN_HOME = '/should-drop'
    process.env.BRAIN_WIKI_ROOT = '/wiki-drop'
    enforceDataRootEnvPrecedence()
    expect(process.env.BRAIN_DATA_ROOT).toBe('/mnt/brain-data')
    expect(process.env.BRAIN_HOME).toBeUndefined()
    expect(process.env.BRAIN_WIKI_ROOT).toBeUndefined()
  })

  it('does nothing when BRAIN_DATA_ROOT is unset', () => {
    capture(['BRAIN_DATA_ROOT', 'BRAIN_HOME', 'BRAIN_WIKI_ROOT'])
    delete process.env.BRAIN_DATA_ROOT
    process.env.BRAIN_HOME = '/keep'
    process.env.BRAIN_WIKI_ROOT = '/keep-wiki'
    enforceDataRootEnvPrecedence()
    expect(process.env.BRAIN_HOME).toBe('/keep')
    expect(process.env.BRAIN_WIKI_ROOT).toBe('/keep-wiki')
  })
})
