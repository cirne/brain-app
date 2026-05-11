import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emlExists, emlPath, maildirPath, readEml, writeEml } from './maildir.js'

describe('maildir UIDVALIDITY paths', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ripmail-maildir-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('namespaces raw EML files by UIDVALIDITY', () => {
    const path = writeEml(home, 'src', 'INBOX', 12345, 42, 'raw body')

    expect(maildirPath(home, 'src', 'INBOX', 12345)).toBe(join(home, 'src', 'INBOX', '12345'))
    expect(emlPath(home, 'src', 'INBOX', 12345, 42)).toBe(join(home, 'src', 'INBOX', '12345', '42.eml'))
    expect(path).toBe(join(home, 'src', 'INBOX', '12345', '42.eml'))
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('raw body')
    expect(readEml(home, 'src', 'INBOX', 12345, 42)?.toString('utf8')).toBe('raw body')
    expect(emlExists(home, 'src', 'INBOX', 12345, 42)).toBe(true)
    expect(emlExists(home, 'src', 'INBOX', 99999, 42)).toBe(false)
  })
})
