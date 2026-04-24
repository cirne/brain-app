import { describe, expect, it } from 'vitest'
import {
  profilingLeadCopy,
  profilingLeadCopyMultiTenant,
  wikiBuildoutLeadCopy,
  wikiBuildoutLeadCopyMultiTenant,
} from './onboardingLeadCopy.js'

describe('onboardingLeadCopy', () => {
  it('keeps single-tenant profiling copy focused on local vault', () => {
    expect(profilingLeadCopy.title).toBe('Building your profile')
    expect(profilingLeadCopy.lead).toContain('vault on this Mac')
  })

  it('uses multitenant profiling copy about learning from email', () => {
    expect(profilingLeadCopyMultiTenant.title).toBe('Building your profile')
    expect(profilingLeadCopyMultiTenant.lead).toContain('learning from your emails')
    expect(profilingLeadCopyMultiTenant.lead).toContain('few moments')
  })

  it('keeps single-tenant wiki buildout copy focused on local-only vault', () => {
    expect(wikiBuildoutLeadCopy.title).toBe('Setting up your wiki')
    expect(wikiBuildoutLeadCopy.lead).toContain('vault on this Mac')
  })

  it('uses multitenant wiki buildout copy without local-Mac device framing', () => {
    expect(wikiBuildoutLeadCopyMultiTenant.title).toBe('Setting up your wiki')
    expect(wikiBuildoutLeadCopyMultiTenant.lead).toContain('your vault')
    expect(wikiBuildoutLeadCopyMultiTenant.lead).not.toContain('this Mac')
  })
})
