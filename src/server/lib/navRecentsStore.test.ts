import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brainLayoutNavRecentsPath } from './brainLayout.js'
import { runWithTenantContextAsync } from './tenantContext.js'
import {
  addNavRecentsItem,
  clearNavRecents,
  makeNavRecentsId,
  readNavRecents,
  removeNavRecentsItem,
  upsertEmailNavRecents,
} from './navRecentsStore.js'

describe('navRecentsStore', () => {
  let home: string

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true })
  })

  it('add, read, remove', async () => {
    home = join(tmpdir(), `nr-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    await runWithTenantContextAsync({ tenantUserId: '_single', workspaceHandle: '_single', homeDir: home }, async () => {
      await addNavRecentsItem({
        id: makeNavRecentsId('doc', 'ideas/x.md'),
        type: 'doc',
        title: 'ideas/x.md',
        path: 'ideas/x.md',
      })
      const rows = await readNavRecents()
      expect(rows).toHaveLength(1)
      expect(rows[0].path).toBe('ideas/x.md')

      await removeNavRecentsItem(rows[0].id)
      expect(await readNavRecents()).toHaveLength(0)
    })
  })

  it('upsertEmailNavRecents dedupes and updates title', async () => {
    home = join(tmpdir(), `nr-email-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    await runWithTenantContextAsync({ tenantUserId: '_single', workspaceHandle: '_single', homeDir: home }, async () => {
      expect(await upsertEmailNavRecents('tid', 'First', 'a@b.c')).toBe(true)
      expect(await upsertEmailNavRecents('tid', 'Second', 'a@b.c')).toBe(true)
      const rows = await readNavRecents()
      expect(rows).toHaveLength(1)
      expect(rows[0].title).toBe('Second')

      expect(await upsertEmailNavRecents('tid', 'Second', 'a@b.c')).toBe(false)
    })
  })

  it('clearNavRecents empties file', async () => {
    home = join(tmpdir(), `nr-cl-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    await runWithTenantContextAsync({ tenantUserId: '_single', workspaceHandle: '_single', homeDir: home }, async () => {
      await addNavRecentsItem({
        id: 'doc:x',
        type: 'doc',
        title: 'x',
        path: 'x',
      })
      await clearNavRecents()
      expect(await readNavRecents()).toHaveLength(0)
    })
  })

  it('writes under var/nav-recents.json', async () => {
    home = join(tmpdir(), `nr-path-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    await runWithTenantContextAsync({ tenantUserId: '_single', workspaceHandle: '_single', homeDir: home }, async () => {
      await addNavRecentsItem({
        id: 'doc:y',
        type: 'doc',
        title: 'y',
        path: 'y',
      })
      const p = brainLayoutNavRecentsPath(home)
      expect(readFileSync(p, 'utf-8')).toContain('"doc:y"')
    })
  })
})
