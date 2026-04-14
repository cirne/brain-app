/**
 * From a unified diff string, keep only deletion and addition lines (red/green).
 * Omits file headers (---/+++), hunk headers (@@), context (space-prefixed), and other metadata.
 */
export function unifiedDiffChangedLinesOnly(unified: string): string[] {
  const out: string[] = []
  for (const line of unified.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) out.push(line)
    else if (line.startsWith('-') && !line.startsWith('---')) out.push(line)
  }
  return out
}
