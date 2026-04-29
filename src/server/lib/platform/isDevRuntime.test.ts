import { describe, it, expect, afterEach } from 'vitest'
import { isDevRuntime } from './isDevRuntime.js'

describe('isDevRuntime', () => {
  let prev: string | undefined

  afterEach(() => {
    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
  })

  it('is false only when NODE_ENV is production', () => {
    prev = process.env.NODE_ENV

    process.env.NODE_ENV = 'production'
    expect(isDevRuntime()).toBe(false)

    process.env.NODE_ENV = 'development'
    expect(isDevRuntime()).toBe(true)

    process.env.NODE_ENV = 'test'
    expect(isDevRuntime()).toBe(true)

    delete process.env.NODE_ENV
    expect(isDevRuntime()).toBe(true)
  })
})
