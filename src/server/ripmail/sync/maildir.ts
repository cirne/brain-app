/**
 * Maildir storage — write and read raw .eml files.
 * Structure: <ripmail_home>/<source_id>/<folder>/<uid>.eml
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function maildirPath(ripmailHome: string, sourceId: string, folder: string): string {
  return join(ripmailHome, sourceId, folder)
}

export function emlPath(ripmailHome: string, sourceId: string, folder: string, uid: number): string {
  return join(maildirPath(ripmailHome, sourceId, folder), `${uid}.eml`)
}

export function writeEml(
  ripmailHome: string,
  sourceId: string,
  folder: string,
  uid: number,
  content: Buffer | string,
): string {
  const dir = maildirPath(ripmailHome, sourceId, folder)
  mkdirSync(dir, { recursive: true })
  const path = emlPath(ripmailHome, sourceId, folder, uid)
  writeFileSync(path, content)
  return path
}

export function readEml(
  ripmailHome: string,
  sourceId: string,
  folder: string,
  uid: number,
): Buffer | null {
  const path = emlPath(ripmailHome, sourceId, folder, uid)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

export function emlExists(
  ripmailHome: string,
  sourceId: string,
  folder: string,
  uid: number,
): boolean {
  return existsSync(emlPath(ripmailHome, sourceId, folder, uid))
}
