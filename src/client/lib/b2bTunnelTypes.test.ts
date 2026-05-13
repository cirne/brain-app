import { describe, expect, it } from 'vitest'
import { parseB2BTunnelListResponse } from './b2bTunnelTypes.js'

describe('parseB2BTunnelListResponse', () => {
  it('maps merged API rows into B2BTunnelListRowApi with defaults', () => {
    const rows = parseB2BTunnelListResponse({
      tunnels: [
        {
          peerUserId: 'u1',
          outboundGrantId: 'out-1',
          inboundGrantId: null,
          peerHandle: '@alice',
          peerDisplayName: 'Alice Chen',
          outboundSessionId: 'sid-o',
          grantId: 'out-1',
          ownerDisplayName: 'Alice Chen',
          ownerHandle: '@alice',
          ownerId: 'u1',
          sessionId: 'sid-o',
          lastActivityMs: 1700006400000,
          snippet: 'Latest note',
          pendingReviewCount: 2,
          inboundPolicy: 'review',
        },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      peerHandle: '@alice',
      peerDisplayName: 'Alice Chen',
      outboundGrantId: 'out-1',
      lastActivityMs: 1700006400000,
      snippet: 'Latest note',
      pendingReviewCount: 2,
      inboundPolicy: 'review',
    })
  })

  it('drops tunnels without peerHandle', () => {
    expect(
      parseB2BTunnelListResponse({
        tunnels: [{ outboundGrantId: 'x', peerHandle: '   ', peerDisplayName: 'Y' }],
      }),
    ).toEqual([])
  })
})
