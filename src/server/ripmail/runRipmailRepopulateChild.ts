import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export type RipmailRepopulateChildLogFields = {
  ripmailHome?: string
  tenantUserId?: string
  workspaceHandle?: string
  stored?: number
  expected?: number
}

type RipmailRepopulateCommand = {
  command: string
  args: string[]
  cwd?: string
}

export function resolveRipmailRepopulateCommand(ripmailHome: string): RipmailRepopulateCommand {
  const here = dirname(fileURLToPath(import.meta.url))
  const compiledCandidates = [
    join(here, 'repopulateRipmailMaildirsCli.js'),
    join(here, 'ripmail/repopulateRipmailMaildirsCli.js'),
  ]
  for (const compiledCli of compiledCandidates) {
    if (existsSync(compiledCli)) {
      return {
        command: process.execPath,
        args: [compiledCli, ripmailHome],
      }
    }
  }

  const repoRoot = resolve(here, '../../..')
  const sourceCli = join(repoRoot, 'src/server/ripmail/repopulateRipmailMaildirsCli.ts')
  return {
    command: 'npx',
    args: ['tsx', '--tsconfig', join(repoRoot, 'tsconfig.server.json'), sourceCli, ripmailHome],
    cwd: repoRoot,
  }
}

export function runRipmailRepopulateChild(
  ripmailHome: string,
  logFields: RipmailRepopulateChildLogFields = {},
): Promise<void> {
  const startedAt = Date.now()
  const cmd = resolveRipmailRepopulateCommand(ripmailHome)
  const child = spawn(cmd.command, cmd.args, {
    cwd: cmd.cwd,
    env: process.env,
    stdio: ['ignore', 'inherit', 'pipe'],
  })
  let stderr = ''

  brainLogger.info(
    {
      ...logFields,
      ripmailHome,
      childPid: child.pid ?? null,
      command: cmd.command,
    },
    'ripmail:rebuild:child-start',
  )

  child.stderr.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString()
    if (stderr.length > 16_384) stderr = stderr.slice(-16_384)
  })

  return new Promise((resolvePromise, reject) => {
    child.once('error', (err) => {
      brainLogger.warn(
        {
          ...logFields,
          ripmailHome,
          durationMs: Date.now() - startedAt,
          err,
        },
        'ripmail:rebuild:child-error',
      )
      reject(err)
    })
    child.once('close', (code, signal) => {
      const durationMs = Date.now() - startedAt
      if (code === 0) {
        brainLogger.info(
          {
            ...logFields,
            ripmailHome,
            code,
            signal,
            durationMs,
          },
          'ripmail:rebuild:child-complete',
        )
        resolvePromise()
        return
      }

      const message = stderr.trim() || `ripmail rebuild child exited with code ${code ?? 'null'}`
      brainLogger.warn(
        {
          ...logFields,
          ripmailHome,
          code,
          signal,
          durationMs,
          stderr: message,
        },
        'ripmail:rebuild:child-failed',
      )
      reject(new Error(message))
    })
  })
}
