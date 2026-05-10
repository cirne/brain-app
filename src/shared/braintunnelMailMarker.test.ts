import { describe, it, expect } from 'vitest'
import {
  BRAINTUNNEL_MAIL_SUBJECT_PREFIX,
  assertOptionalBrainQueryGrantId,
  buildB2bDraftEmailInstruction,
  displaySubjectWithoutBraintunnelMarker,
  isBraintunnelMailSubject,
  normalizeSubjectForBraintunnelDetection,
} from './braintunnelMailMarker.js'

describe('braintunnelMailMarker', () => {
  it('detects marker after Re: chain', () => {
    expect(isBraintunnelMailSubject('Re: [braintunnel] hello')).toBe(true)
    expect(isBraintunnelMailSubject('Re: re: [braintunnel] hello')).toBe(true)
    expect(isBraintunnelMailSubject('Re: hello')).toBe(false)
    expect(isBraintunnelMailSubject('[Braintunnel] no')).toBe(false)
  })

  it('normalizeSubjectForBraintunnelDetection strips Re:/Fwd:', () => {
    expect(normalizeSubjectForBraintunnelDetection('  Re:  Fwd:  [braintunnel] x  ')).toBe(
      `${BRAINTUNNEL_MAIL_SUBJECT_PREFIX} x`,
    )
  })

  it('displaySubjectWithoutBraintunnelMarker keeps Re: and strips one marker block', () => {
    expect(displaySubjectWithoutBraintunnelMarker('Re: [braintunnel] follow up')).toBe('Re: follow up')
    expect(displaySubjectWithoutBraintunnelMarker('[braintunnel] only')).toBe('only')
  })

  it('buildB2bDraftEmailInstruction prepends subject rule and optional grant note', () => {
    const out = buildB2bDraftEmailInstruction('Ask about the timeline.', 'bqg_0123456789abcdef01234567')
    expect(out).toContain(BRAINTUNNEL_MAIL_SUBJECT_PREFIX)
    expect(out).toContain('Ask about the timeline.')
    expect(out).toContain('bqg_0123456789abcdef01234567')
    expect(out).toContain('(Assistant-only grant id')
  })

  it('assertOptionalBrainQueryGrantId rejects bad ids', () => {
    expect(() => assertOptionalBrainQueryGrantId('bad')).toThrow('grant_id')
    expect(() => assertOptionalBrainQueryGrantId(undefined)).not.toThrow()
  })
})
