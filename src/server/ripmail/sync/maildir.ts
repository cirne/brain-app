/**
 * Maildir storage — write and read raw .eml files.
 * Structure: <ripmail_home>/<source_id>/<folder>/<uidvalidity>/<uid>.eml
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function maildirPath(
  ripmailHome: string,
  sourceId: string,
  folder: string,
  uidvalidity: number,
): string {
  return join(ripmailHome, sourceId, folder, String(uidvalidity))
}

export function emlPath(
  ripmailHome: string,
  sourceId: string,
  folder: string,
  uidvalidity: number,
  uid: number,
): string {
  return join(maildirPath(ripmailHome, sourceId, folder, uidvalidity), `${uid}.eml`)
}

export function writeEml(
  ripmailHome: string,
  sourceId: string,
  folder: string,
  uidvalidity: number,
  uid: number,
  content: Buffer | string,
): string {
  const dir = maildirPath(ripmailHome, sourceId, folder, uidvalidity)
  mkdirSync(dir, { recursive: true })
  const path = emlPath(ripmailHome, sourceId, folder, uidvalidity, uid)
  writeFileSync(path, content)
  return path
}

export function readEml(
  ripmailHome: string,
  sourceId: string,
  folder: string,
  uidvalidity: number,
  uid: number,
): Buffer | null {
  const path = emlPath(ripmailHome, sourceId, folder, uidvalidity, uid)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

export function emlExists(
  ripmailHome: string,
  sourceId: string,
  folder: string,
  uidvalidity: number,
  uid: number,
): boolean {
  return existsSync(emlPath(ripmailHome, sourceId, folder, uidvalidity, uid))
}
