import { describe, it, expect } from 'vitest'
import { buildDraftEditFlags } from './ripmailCli.js'

describe('buildDraftEditFlags', () => {
  it('should join multiple --to recipients with commas', () => {
    const flags = buildDraftEditFlags({
      to: ['alan@jpmorgan.com', 'team_macrum@jpmorgan.com'],
    })
    expect(flags).toBe('--to "alan@jpmorgan.com,team_macrum@jpmorgan.com" ')
  })

  it('should join multiple --cc recipients with commas', () => {
    const flags = buildDraftEditFlags({
      cc: ['alice@example.com', 'bob@example.com'],
    })
    expect(flags).toBe('--cc "alice@example.com,bob@example.com" ')
  })

  it('should join multiple --bcc recipients with commas', () => {
    const flags = buildDraftEditFlags({
      bcc: ['hidden@example.com', 'another@example.com'],
    })
    expect(flags).toBe('--bcc "hidden@example.com,another@example.com" ')
  })

  it('should repeat --add-to flags for multiple values', () => {
    const flags = buildDraftEditFlags({
      add_to: ['new1@example.com', 'new2@example.com'],
    })
    expect(flags).toBe('--add-to "new1@example.com" --add-to "new2@example.com" ')
  })

  it('should repeat --remove-cc flags for multiple values', () => {
    const flags = buildDraftEditFlags({
      remove_cc: ['old1@example.com', 'old2@example.com'],
    })
    expect(flags).toBe('--remove-cc "old1@example.com" --remove-cc "old2@example.com" ')
  })

  it('should handle single recipient correctly', () => {
    const flags = buildDraftEditFlags({
      to: ['single@example.com'],
    })
    expect(flags).toBe('--to "single@example.com" ')
  })

  it('should handle empty arrays correctly', () => {
    const flags = buildDraftEditFlags({
      to: [],
      cc: [],
    })
    expect(flags).toBe('')
  })

  it('should handle mixed flags correctly', () => {
    const flags = buildDraftEditFlags({
      subject: 'Test Subject',
      to: ['alice@example.com', 'bob@example.com'],
      cc: ['charlie@example.com'],
      add_cc: ['dave@example.com'],
      remove_to: ['eve@example.com'],
    })
    expect(flags).toContain('--subject "Test Subject"')
    expect(flags).toContain('--to "alice@example.com,bob@example.com"')
    expect(flags).toContain('--cc "charlie@example.com"')
    expect(flags).toContain('--add-cc "dave@example.com"')
    expect(flags).toContain('--remove-to "eve@example.com"')
  })
})
