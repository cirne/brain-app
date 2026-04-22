import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** TCC-protected paths used to infer FDA (see BUG-004). ENOENT on one path is not "no FDA". */
const FDA_PROBE_REL_PATHS = [
  ['Library', 'Containers', 'com.apple.stocks'],
  ['Library', 'Safari'],
  ['Library', 'Mail'],
] as const

const PROBE_LABELS = ['stocks', 'safari', 'mail'] as const

export interface FdaProbeRow {
  label: string
  path: string
  exists: boolean
  readDirOk: boolean
  errnoCode: string | null
  message: string | null
}

/** Full diagnostic snapshot (Node process). Use for logs and GET /api/onboarding/fda?detail=1. */
export interface FdaProbeDetail {
  platform: string
  pid: number
  cwd: string
  home: string
  granted: boolean
  probes: FdaProbeRow[]
}

function probeOneRow(label: string, absolutePath: string): FdaProbeRow {
  try {
    statSync(absolutePath)
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return {
      label,
      path: absolutePath,
      exists: false,
      readDirOk: false,
      errnoCode: err.code ?? null,
      message: err.message ?? null,
    }
  }
  try {
    readdirSync(absolutePath)
    return {
      label,
      path: absolutePath,
      exists: true,
      readDirOk: true,
      errnoCode: null,
      message: null,
    }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return {
      label,
      path: absolutePath,
      exists: true,
      readDirOk: false,
      errnoCode: err.code ?? null,
      message: err.message ?? null,
    }
  }
}

/**
 * Per-path FDA probe for the **current Node process** (bundled server). TCC is per executable:
 * Ghostty/Terminal may differ from `Braintunnel.app`’s embedded `node` / `ripmail`.
 */
export function getFdaProbeDetail(): FdaProbeDetail {
  const home = homedir()
  if (process.platform !== 'darwin') {
    return {
      platform: process.platform,
      pid: process.pid,
      cwd: process.cwd(),
      home,
      granted: true,
      probes: [],
    }
  }
  const probes = FDA_PROBE_REL_PATHS.map((parts, i) =>
    probeOneRow(PROBE_LABELS[i] ?? `p${i}`, join(home, ...parts)),
  )
  const granted = probes.some((r) => r.readDirOk)
  return {
    platform: process.platform,
    pid: process.pid,
    cwd: process.cwd(),
    home,
    granted,
    probes,
  }
}

/**
 * Emit multi-line `[brain-app] FDA probe …` lines (startup + debugging without rebuilding Tauri).
 */
export function logFdaProbeForStartup(logLine: (line: string) => void): void {
  const d = getFdaProbeDetail()
  logLine(
    `FDA probe (Node) pid=${d.pid} platform=${d.platform} cwd=${d.cwd} home=${d.home}`,
  )
  if (d.probes.length === 0) {
    logLine('FDA probe: non-macOS — granted (no FDA concept)')
    logLine('Full Disk Access: granted')
    return
  }
  for (const r of d.probes) {
    const rd = r.readDirOk ? 'ok' : 'fail'
    const errTail =
      r.readDirOk || (!r.errnoCode && !r.message)
        ? ''
        : ` errno=${r.errnoCode ?? r.message?.slice(0, 120) ?? '—'}`
    logLine(`FDA probe [${r.label}] path=${r.path} exists=${r.exists} readDir=${rd}${errTail}`)
  }
  logLine(`FDA probe (Node) inferred granted=${d.granted}`)
  logLine(`Full Disk Access: ${d.granted ? 'granted' : 'NOT granted'}`)
}

/**
 * Probe Full Disk Access by reading TCC-protected paths. Success on any probe ⇒ FDA granted.
 * On non-macOS, returns `true` (no FDA concept).
 */
export function isFdaGranted(): boolean {
  return getFdaProbeDetail().granted
}
