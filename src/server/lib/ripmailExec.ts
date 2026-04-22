import type { ExecOptions, SpawnOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ripmailBin } from './ripmailBin.js'
import { RIPMAIL_QUERY_TIMEOUT_MS, runRipmailArgv } from './ripmailRun.js'
import { tokenizeRipmailArgString } from './ripmailArgvTokenize.js'

function resolveExecCwd(cwd: ExecOptions['cwd']): string | undefined {
  if (cwd === undefined) return undefined
  if (typeof cwd === 'string') return cwd
  if (cwd instanceof URL) {
    return cwd.protocol === 'file:' ? fileURLToPath(cwd) : cwd.pathname
  }
  return undefined
}

export { ripmailProcessEnv } from './brainHome.js'
export {
  getRipmailChildDebugSnapshot,
  RIPMAIL_BACKFILL_TIMEOUT_MS,
  RIPMAIL_QUERY_TIMEOUT_MS,
  RIPMAIL_REFRESH_TIMEOUT_MS,
  RIPMAIL_SEND_TIMEOUT_MS,
  RIPMAIL_STATUS_TIMEOUT_MS,
  RipmailNonZeroExitError,
  RipmailTimeoutError,
  runRipmailArgv,
  terminateAllTrackedRipmailChildren,
} from './ripmailRun.js'

/**
 * Run ripmail with argv (no shell). Prefer this for new code.
 */
export async function execRipmailArgv(
  argv: string[],
  options?: ExecOptions & { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs =
    options?.timeout !== undefined && options.timeout > 0
      ? options.timeout
      : RIPMAIL_QUERY_TIMEOUT_MS
  const r = await runRipmailArgv(argv, {
    timeoutMs,
    maxBuffer: options?.maxBuffer,
    env: options?.env as SpawnOptions['env'],
    cwd: resolveExecCwd(options?.cwd),
    signal: options?.signal,
  })
  return { stdout: r.stdout, stderr: r.stderr }
}

/**
 * `exec`-style string after resolved binary (no shell). UTF-8 stdout/stderr.
 * Command must start with `ripmailBin()`; remainder is tokenized.
 */
export function execRipmailAsync(
  command: string,
  options?: ExecOptions & { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  const bin = ripmailBin()
  const trimmed = command.trimStart()
  if (!trimmed.startsWith(bin)) {
    return Promise.reject(new Error(`execRipmailAsync: command must start with ${bin}`))
  }
  const tail = trimmed.slice(bin.length).trimStart()
  const argv = tokenizeRipmailArgString(tail)
  return execRipmailArgv(argv, options)
}
