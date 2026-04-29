import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  computeRipmailDockerInputsHash,
  listRipmailDockerInputPaths,
} from './ripmailDockerInputsHash.js'

describe('ripmailDockerInputsHash', () => {
  it('hashes workspace manifests and ripmail tree (no git)', () => {
    const root = join(tmpdir(), `ripmail-hash-${Date.now()}`)
    mkdirSync(join(root, 'ripmail', 'src'), { recursive: true })
    writeFileSync(
      join(root, 'Cargo.toml'),
      `[workspace]\nmembers = ["ripmail"]\nresolver = "2"\n`,
    )
    writeFileSync(join(root, 'Cargo.lock'), '# lock\n')
    writeFileSync(join(root, 'ripmail', 'Cargo.toml'), '[package]\nname = "ripmail"\nversion = "0.1.0"\nedition = "2021"\n')
    writeFileSync(join(root, 'ripmail', 'src', 'lib.rs'), '// hi\n')

    const a = computeRipmailDockerInputsHash(root)
    const b = computeRipmailDockerInputsHash(root)
    expect(a).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(a).toBe(b)

    writeFileSync(join(root, 'ripmail', 'src', 'lib.rs'), '// bye\n')
    expect(computeRipmailDockerInputsHash(root)).not.toBe(a)

    rmSync(root, { recursive: true, force: true })
  })

  it('listRipmailDockerInputPaths includes Cargo.toml and ripmail files', () => {
    const root = join(tmpdir(), `ripmail-list-${Date.now()}`)
    mkdirSync(join(root, 'ripmail', 'src'), { recursive: true })
    writeFileSync(join(root, 'Cargo.toml'), '[workspace]\n')
    writeFileSync(join(root, 'Cargo.lock'), '')
    writeFileSync(join(root, 'ripmail', 'Cargo.toml'), '[package]\nname = "ripmail"\n')
    writeFileSync(join(root, 'ripmail', 'src', 'main.rs'), '')

    const paths = listRipmailDockerInputPaths(root)
    expect(paths).toContain('Cargo.toml')
    expect(paths).toContain('Cargo.lock')
    expect(paths.some((p: string) => p.startsWith('ripmail/'))).toBe(true)

    rmSync(root, { recursive: true, force: true })
  })
})
