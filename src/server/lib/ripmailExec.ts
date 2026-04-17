import { exec } from 'node:child_process'
import type { ExecOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { ripmailProcessEnv } from './brainHome.js'

const execAsync = promisify(exec)

/**
 * `exec` with `RIPMAIL_HOME` set for Brain (`data/ripmail` in dev). Options `env` is merged on top.
 * UTF-8 stdout/stderr (string), not Buffer.
 */
export function execRipmailAsync(
  command: string,
  options?: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, {
    encoding: 'utf8',
    ...options,
    env: { ...ripmailProcessEnv(), ...options?.env },
  }) as Promise<{ stdout: string; stderr: string }>
}

export { ripmailProcessEnv } from './brainHome.js'
