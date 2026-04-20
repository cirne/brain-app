import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { brainHome } from './brainHome.js'
import { brainLayoutVaultVerifierPath } from './brainLayout.js'
import type { VaultVerifierV1 } from './vaultCrypto.js'

export function vaultVerifierPath(): string {
  return brainLayoutVaultVerifierPath(brainHome())
}

export function vaultVerifierExistsSync(): boolean {
  return existsSync(vaultVerifierPath())
}

export async function readVaultVerifier(): Promise<VaultVerifierV1 | null> {
  const p = vaultVerifierPath()
  if (!existsSync(p)) return null
  try {
    const raw = await readFile(p, 'utf-8')
    const j = JSON.parse(raw) as VaultVerifierV1
    if (j.v !== 1 || j.algo !== 'scrypt' || typeof j.salt !== 'string' || typeof j.hash !== 'string') {
      return null
    }
    return j
  } catch {
    return null
  }
}

export async function writeVaultVerifier(record: VaultVerifierV1): Promise<void> {
  const p = vaultVerifierPath()
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(record, null, 2), 'utf-8')
}
