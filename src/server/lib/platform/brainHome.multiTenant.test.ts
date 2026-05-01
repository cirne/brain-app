import { describe, expect, it } from 'vitest'
import { brainHome, brainWikiParentRoot, ripmailHomeForBrain } from './brainHome.js'
import { brainLayoutRipmailDir } from './brainLayout.js'
import { runWithTenantContext } from '@server/lib/tenant/tenantContext.js'

describe('brainHome multi-tenant', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevRipmail = process.env.RIPMAIL_HOME

  it('brainHome reads tenant context; ripmail home ignores global RIPMAIL_HOME in MT mode', () => {
    process.env.BRAIN_DATA_ROOT = '/srv/data'
    delete process.env.RIPMAIL_HOME
    const home = '/srv/data/u1'
    runWithTenantContext({ tenantUserId: 'u1', workspaceHandle: 'user-one', homeDir: home }, () => {
      expect(brainHome()).toBe(home)
      expect(brainWikiParentRoot()).toBe(home)
      expect(ripmailHomeForBrain()).toBe(brainLayoutRipmailDir(home))
    })

    process.env.RIPMAIL_HOME = '/evil/other'
    runWithTenantContext({ tenantUserId: 'u1', workspaceHandle: 'user-one', homeDir: home }, () => {
      expect(ripmailHomeForBrain()).toBe(brainLayoutRipmailDir(home))
    })

    process.env.RIPMAIL_HOME = prevRipmail
    process.env.BRAIN_DATA_ROOT = prevRoot
  })

  it('brainHome throws outside tenant context when BRAIN_DATA_ROOT set', () => {
    const prevHome = process.env.BRAIN_HOME
    try {
      delete process.env.BRAIN_HOME
      process.env.BRAIN_DATA_ROOT = '/data'
      expect(() => brainHome()).toThrow(/tenant_context_required/)
    } finally {
      if (prevHome === undefined) delete process.env.BRAIN_HOME
      else process.env.BRAIN_HOME = prevHome
      if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
      else process.env.BRAIN_DATA_ROOT = prevRoot
    }
  })
})
