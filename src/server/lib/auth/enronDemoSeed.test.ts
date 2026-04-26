import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ENRON_DEMO_PROVISIONED_FILENAME,
  ensureProvisionedMarkerWhenMailReady,
  isEnronDemoTenantProvisioned,
  isEnronDemoTenantReady,
  resetEnronDemoSeedStateForTests,
} from './enronDemoSeed.js'
import { readFile } from 'node:fs/promises'

describe('enronDemoSeed', () => {
  afterEach(() => {
    resetEnronDemoSeedStateForTests()
  })

  it('isEnronDemoTenantReady requires non-empty ripmail.db', async () => {
    const root = await mkdtemp(join(tmpdir(), 'enron-ready-'))
    try {
      const home = join(root, 't1')
      await mkdir(join(home, 'ripmail'), { recursive: true })
      expect(isEnronDemoTenantReady(home)).toBe(false)
      await writeFile(join(home, 'ripmail', 'ripmail.db'), 'x', 'utf8')
      expect(isEnronDemoTenantReady(home)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('isEnronDemoTenantProvisioned is true with marker file or non-empty ripmail.db', async () => {
    const root = await mkdtemp(join(tmpdir(), 'enron-prov-'))
    try {
      const home = join(root, 't2')
      await mkdir(join(home, 'ripmail'), { recursive: true })
      expect(isEnronDemoTenantProvisioned(home)).toBe(false)
      await writeFile(join(home, ENRON_DEMO_PROVISIONED_FILENAME), '{}', 'utf8')
      expect(isEnronDemoTenantProvisioned(home)).toBe(true)
      await rm(join(home, ENRON_DEMO_PROVISIONED_FILENAME))
      await writeFile(join(home, 'ripmail', 'ripmail.db'), 'z', 'utf8')
      expect(isEnronDemoTenantProvisioned(home)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ensureProvisionedMarkerWhenMailReady writes marker when ripmail.db is non-empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'enron-migrate-'))
    try {
      const home = join(root, 't3')
      await mkdir(join(home, 'ripmail'), { recursive: true })
      await writeFile(join(home, 'ripmail', 'ripmail.db'), 'idx', 'utf8')
      ensureProvisionedMarkerWhenMailReady(home)
      const raw = await readFile(join(home, ENRON_DEMO_PROVISIONED_FILENAME), 'utf8')
      const j = JSON.parse(raw) as { provisionedAt?: string }
      expect(typeof j.provisionedAt).toBe('string')
      expect(isEnronDemoTenantProvisioned(home)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
