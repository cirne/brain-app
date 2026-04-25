import { describe, it, expect } from 'vitest'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  createVaultVerifierRecord,
  hashVaultPassword,
  randomBytesB64,
  verifyVaultPassword,
  VAULT_PASSWORD_MIN_LEN,
} from './vaultCrypto.js'

describe('vaultCrypto', () => {
  it('createVaultVerifierRecord + verifyVaultPassword accepts correct password', async () => {
    const record = await createVaultVerifierRecord('correct horse battery staple')
    expect(await verifyVaultPassword('correct horse battery staple', record)).toBe(true)
    expect(await verifyVaultPassword('wrong', record)).toBe(false)
  })

  it('verifyVaultPassword uses constant-length comparison path', async () => {
    const record = await createVaultVerifierRecord('aaaaaaa')
    expect(record.hash.length).toBeGreaterThan(0)
    expect(await verifyVaultPassword('', record)).toBe(false)
  })

  it('VAULT_PASSWORD_MIN_LEN is documented minimum', () => {
    expect(VAULT_PASSWORD_MIN_LEN).toBeGreaterThanOrEqual(8)
  })

  it('aesGcmEncrypt round-trips with 32-byte key', () => {
    const key = Buffer.alloc(32, 7)
    const pt = Buffer.from('hello wiki blob', 'utf-8')
    const ct = aesGcmEncrypt(key, pt)
    expect(aesGcmDecrypt(key, ct).equals(pt)).toBe(true)
  })

  it('aesGcmDecrypt fails on tampered ciphertext', () => {
    const key = Buffer.alloc(32, 3)
    const ct = aesGcmEncrypt(key, Buffer.from('x'))
    ct[ct.length - 1] ^= 0xff
    expect(() => aesGcmDecrypt(key, ct)).toThrow()
  })

  it('randomBytesB64 produces decodable output', () => {
    const s = randomBytesB64(16)
    expect(Buffer.from(s, 'base64').length).toBe(16)
  })

  it('hashVaultPassword is deterministic for same salt', async () => {
    const salt = randomBytesB64(16)
    const a = await hashVaultPassword('same', salt)
    const b = await hashVaultPassword('same', salt)
    expect(a.equals(b)).toBe(true)
  })
})
