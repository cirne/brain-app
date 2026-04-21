import { describe, expect, it } from 'vitest'
import {
  profilingLeadCopy,
  profilingLeadCopyMultiTenant,
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
})
