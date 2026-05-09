import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { USER_ID_RANDOM_LEN } from './handleMeta.js'
import { listTenantUserIdsUnderDataRoot } from './listTenantUserIdsUnderDataRoot.js'

describe('listTenantUserIdsUnderDataRoot', () => {
  let prevRoot: string | undefined
  let scratch: string

  beforeEach(async () => {
    prevRoot = process.env.BRAIN_DATA_ROOT
    scratch = await mkdtemp(join(tmpdir(), 'brain-tenant-list-'))
    process.env.BRAIN_DATA_ROOT = scratch
    await mkdir(join(scratch, `.global`), { recursive: true })
  })

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
  })

  it('lists only usr_* directories with correct length', async () => {
    const ok = `usr_${'a'.repeat(USER_ID_RANDOM_LEN)}`
    const badPrefix = `usx_${'a'.repeat(USER_ID_RANDOM_LEN)}`
    const short = 'usr_short'
    await mkdir(join(scratch, ok), { recursive: true })
    await mkdir(join(scratch, badPrefix), { recursive: true })
    await mkdir(join(scratch, short), { recursive: true })
    await writeFile(join(scratch, 'readme.txt'), 'x')
    expect(await listTenantUserIdsUnderDataRoot()).toEqual([ok])
  })
})
