import type { drive_v3 } from 'googleapis'

/** Stable content identity for Drive files; matches `cloud_file_meta.content_hash` during sync. */
export function driveFileFingerprint(f: drive_v3.Schema$File): string {
  const md5 = f.md5Checksum?.trim()
  if (md5) return `md5:${md5}`
  const rev = f.headRevisionId?.trim()
  if (rev) return `rev:${rev}`
  const mt = f.modifiedTime?.trim() ?? ''
  const sz = String(f.size ?? '')
  return `meta:${mt}:${sz}:${f.mimeType ?? ''}`
}
