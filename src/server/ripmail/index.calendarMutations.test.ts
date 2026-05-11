import { describe, it, expect } from 'vitest'
import { ripmailCalendarCancelEvent } from './index.js'

describe('ripmailCalendarCancelEvent', () => {
  it('rejects scope=future without touching the DB', async () => {
    await expect(ripmailCalendarCancelEvent('/nonexistent-ripmail-home', 'src', 'evt', 'future')).rejects.toThrow(
      /not supported/,
    )
  })
})
