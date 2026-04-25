/**
 * Vault password hashing (scrypt) and optional AEAD primitives for future wiki-at-rest encryption.
 * Wiki encryption is out of scope for the initial vault gate; helpers are shared for a single crypto surface.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export const VAULT_PASSWORD_MIN_LEN = 8

/** scrypt parameters (interactive; N chosen to stay under Node/OpenSSL default maxmem (~32 MiB)). */
export const SCRYPT_PARAMS = {
  N: 2 ** 14,
  r: 8,
  p: 1,
  keyLen: 32,
} as const

export type VaultVerifierV1 = {
  v: 1
  algo: 'scrypt'
  salt: string
  /** base64 32-byte hash */
  hash: string
  scrypt: { N: number; r: number; p: number; keyLen: number }
  createdAt: string
}

export function randomBytesB64(n: number): string {
  return randomBytes(n).toString('base64')
}

export async function hashVaultPassword(password: string, saltB64: string): Promise<Buffer> {
  const salt = Buffer.from(saltB64, 'base64')
  const { N, r, p, keyLen } = SCRYPT_PARAMS
  return await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLen, { N, r, p }, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey as Buffer)
    })
  })
}

export async function createVaultVerifierRecord(password: string): Promise<VaultVerifierV1> {
  const salt = randomBytes(16)
  const saltB64 = salt.toString('base64')
  const hashBuf = await hashVaultPassword(password, saltB64)
  return {
    v: 1,
    algo: 'scrypt',
    salt: saltB64,
    hash: hashBuf.toString('base64'),
    scrypt: {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      keyLen: SCRYPT_PARAMS.keyLen,
    },
    createdAt: new Date().toISOString(),
  }
}

export async function verifyVaultPassword(
  password: string,
  record: VaultVerifierV1,
): Promise<boolean> {
  if (record.algo !== 'scrypt' || record.v !== 1) return false
  const expected = Buffer.from(record.hash, 'base64')
  if (expected.length !== SCRYPT_PARAMS.keyLen) return false
  const got = await hashVaultPassword(password, record.salt)
  if (got.length !== expected.length) return false
  return timingSafeEqual(got, expected)
}

/** AES-256-GCM encrypt (future wiki blobs). Key must be 32 bytes. */
export function aesGcmEncrypt(key: Buffer, plaintext: Buffer): Buffer {
  if (key.length !== 32) throw new Error('aesGcmEncrypt: key must be 32 bytes')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct])
}

/** AES-256-GCM decrypt. */
export function aesGcmDecrypt(key: Buffer, ciphertext: Buffer): Buffer {
  if (key.length !== 32) throw new Error('aesGcmDecrypt: key must be 32 bytes')
  if (ciphertext.length < 12 + 16) throw new Error('aesGcmDecrypt: ciphertext too short')
  const iv = ciphertext.subarray(0, 12)
  const tag = ciphertext.subarray(12, 28)
  const ct = ciphertext.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}
