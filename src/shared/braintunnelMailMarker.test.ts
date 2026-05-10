import { describe, it, expect } from 'vitest'
import {
  BRAINTUNNEL_MAIL_SUBJECT_PREFIX,
  assertOptionalBrainQueryGrantId,
  displaySubjectWithoutBraintunnelMarker,
  ensureBraintunnelCollaboratorSubject,
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

  it('ensureBraintunnelCollaboratorSubject prepends marker and preserves Re: chain', () => {
    expect(ensureBraintunnelCollaboratorSubject('Status update')).toBe('[braintunnel] Status update')
    expect(ensureBraintunnelCollaboratorSubject('Re: Status')).toBe(`Re: ${BRAINTUNNEL_MAIL_SUBJECT_PREFIX} Status`)
    expect(ensureBraintunnelCollaboratorSubject('Re: [braintunnel] Already')).toBe('Re: [braintunnel] Already')
    expect(ensureBraintunnelCollaboratorSubject('')).toBe(BRAINTUNNEL_MAIL_SUBJECT_PREFIX)
    expect(ensureBraintunnelCollaboratorSubject('   ')).toBe(BRAINTUNNEL_MAIL_SUBJECT_PREFIX)
  })

  it('assertOptionalBrainQueryGrantId rejects bad ids', () => {
    expect(() => assertOptionalBrainQueryGrantId('bad')).toThrow('grant_id')
    expect(() => assertOptionalBrainQueryGrantId(undefined)).not.toThrow()
  })
})
