import { describe, expect, it } from 'vitest'
import type { WikiShareRow } from '@server/lib/shares/wikiSharesRepo.js'
import {
  computePeerLinkPath,
  ownerVaultRelFromShareMountSuffix,
} from '@server/lib/shares/wikiShareTargetPaths.js'

describe('computePeerLinkPath', () => {
  it('dir share', () => {
    const share = {
      id: 'wsh_x',
      owner_id: 'usr_o',
      path_prefix: 'trips/',
      target_kind: 'dir',
    } as WikiShareRow
    expect(computePeerLinkPath('@alice', share)).toBe('@alice/trips')
  })

  it('file share', () => {
    const share = {
      id: 'wsh_y',
      owner_id: 'usr_o',
      path_prefix: 'notes/x.md',
      target_kind: 'file',
    } as WikiShareRow
    expect(computePeerLinkPath('@bob', share)).toBe('@bob/x.md')
  })
})

describe('ownerVaultRelFromShareMountSuffix', () => {
  it('maps dir share suffix to owner wiki-rel', () => {
    const share = {
      id: 'wsh_x',
      owner_id: 'usr_o',
      path_prefix: 'travel/',
      target_kind: 'dir',
    } as WikiShareRow
    expect(ownerVaultRelFromShareMountSuffix(share, 'virginia.md')).toBe('travel/virginia.md')
    expect(ownerVaultRelFromShareMountSuffix(share, '')).toBe('travel')
  })

  it('maps file share to path_prefix regardless of suffix', () => {
    const share = {
      id: 'wsh_y',
      owner_id: 'usr_o',
      path_prefix: 'travel/trip.md',
      target_kind: 'file',
    } as WikiShareRow
    expect(ownerVaultRelFromShareMountSuffix(share, '')).toBe('travel/trip.md')
  })
})
