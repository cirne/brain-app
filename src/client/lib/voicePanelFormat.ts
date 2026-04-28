/** `m:ss` for in-progress recording (e.g. 0:05, 1:23). */
export function formatRecordingDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}
