import { afterEach, describe, expect, it } from 'vitest'
import { elementTextExceedsLineClamp } from './inboxThreadHeaderClamp.js'

describe('elementTextExceedsLineClamp', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns false when unclamped height fits within the line budget', () => {
    const el = document.createElement('div')
    el.textContent = 'short'
    el.style.fontSize = '13px'
    el.style.lineHeight = '20px'
    document.body.appendChild(el)

    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => 20,
    })

    expect(elementTextExceedsLineClamp(el, 3)).toBe(false)
  })

  it('returns true when unclamped height exceeds the line budget', () => {
    const el = document.createElement('div')
    el.textContent = 'many lines'
    el.style.fontSize = '13px'
    el.style.lineHeight = '20px'
    document.body.appendChild(el)

    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => 80,
    })

    expect(elementTextExceedsLineClamp(el, 3)).toBe(true)
  })

  it('restores inline styles after measuring', () => {
    const el = document.createElement('div')
    el.textContent = 'x'
    el.style.marginTop = '7px'
    document.body.appendChild(el)

    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => 10,
    })

    elementTextExceedsLineClamp(el, 3)
    expect(el.style.marginTop).toBe('7px')
  })
})
