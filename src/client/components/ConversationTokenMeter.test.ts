import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@client/test/render.js'
import ConversationTokenMeter from './ConversationTokenMeter.svelte'

const componentSourcePath = join(dirname(fileURLToPath(import.meta.url)), 'ConversationTokenMeter.svelte')

describe('ConversationTokenMeter.svelte', () => {
  it('exposes token count in aria-label and title', () => {
    render(ConversationTokenMeter, { props: { totalTokens: 12345 } })
    const el = screen.getByRole('img')
    const label = el.getAttribute('aria-label') ?? ''
    expect(label).toBe('12.3K / 200K Tokens (6%)')
    expect(el.getAttribute('title')).toBe(label)
  })

  it('shows 12K / 200K Tokens (6%) for 12k of default reference', () => {
    render(ConversationTokenMeter, { props: { totalTokens: 12000 } })
    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toBe('12K / 200K Tokens (6%)')
  })

  it('does not show abbreviated count at or below 100k', () => {
    const { container } = render(ConversationTokenMeter, { props: { totalTokens: 100_000 } })
    expect(container.querySelector('.token-meter-count')).toBeNull()
  })

  it('shows abbreviated count only above 100k', () => {
    const { container } = render(ConversationTokenMeter, { props: { totalTokens: 150_000 } })
    expect(container.querySelector('.token-meter-count')?.textContent?.trim()).toBe('150.0k')
  })

  it('shows count just above 100k threshold', () => {
    const { container } = render(ConversationTokenMeter, { props: { totalTokens: 100_001 } })
    expect(container.querySelector('.token-meter-count')?.textContent?.trim()).toBe('100.0k')
  })

  it('token ring conic gradient starts at 12 o clock (from 0deg)', () => {
    const source = readFileSync(componentSourcePath, 'utf8')
    expect(source).toMatch(/conic-gradient\([\s\S]*?from 0deg/)
    expect(source).not.toContain('from -90deg')
  })
})
