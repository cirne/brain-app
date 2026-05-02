import { describe, expect, it } from 'vitest'
import { cn } from './cn.js'

describe('cn', () => {
  it('joins strings, arrays, and conditional object entries', () => {
    expect(cn('flex', ['items-center', false && 'hidden'], { 'text-muted': true, block: false })).toBe(
      'flex items-center text-muted',
    )
  })

  it('lets later Tailwind utilities win for conflicting groups', () => {
    expect(cn('p-2 text-sm text-muted', 'p-4 text-base text-foreground')).toBe('p-4 text-base text-foreground')
  })

  it('preserves non-conflicting semantic and legacy hook classes', () => {
    expect(cn('composer-context-chip px-2', 'composer-context-chip--action px-3')).toBe(
      'composer-context-chip composer-context-chip--action px-3',
    )
  })
})
