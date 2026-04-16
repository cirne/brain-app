import { describe, it, expect } from 'vitest'
import { getFdaProbeDetail, isFdaGranted, logFdaProbeForStartup } from './fdaProbe.js'

describe('fdaProbe', () => {
  it('isFdaGranted returns a boolean without throwing', () => {
    const v = isFdaGranted()
    expect(typeof v).toBe('boolean')
  })

  it('getFdaProbeDetail returns structured probes', () => {
    const d = getFdaProbeDetail()
    expect(typeof d.granted).toBe('boolean')
    expect(typeof d.pid).toBe('number')
    expect(typeof d.home).toBe('string')
    expect(typeof d.cwd).toBe('string')
    expect(Array.isArray(d.probes)).toBe(true)
    if (process.platform === 'darwin') {
      expect(d.probes).toHaveLength(3)
      for (const r of d.probes) {
        expect(r).toMatchObject({
          label: expect.any(String),
          path: expect.any(String),
          exists: expect.any(Boolean),
          readDirOk: expect.any(Boolean),
        })
      }
    }
  })

  it('logFdaProbeForStartup emits a one-line Full Disk Access summary for runbooks', () => {
    const lines: string[] = []
    logFdaProbeForStartup((line) => lines.push(line))
    const summary = lines.find((l) => l.startsWith('Full Disk Access: '))
    expect(summary).toBeDefined()
    expect(['Full Disk Access: granted', 'Full Disk Access: NOT granted']).toContain(summary)
  })
})
