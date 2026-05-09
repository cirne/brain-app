import { createRequire } from 'node:module'
import { format } from 'node:util'
import pino, { type Logger } from 'pino'
import { isDevRuntime } from '@server/lib/platform/isDevRuntime.js'

const require = createRequire(import.meta.url)

type NrSeverity = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

const isDev = isDevRuntime()

const pinoSink: Logger = pino({
  name: 'braintunnel',
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, singleLine: true },
    },
  }),
})

function newRelicIngestConfigured(): boolean {
  return Boolean(process.env.NEW_RELIC_LICENSE_KEY?.trim())
}

function safeFormat(template: string, values: unknown[]): string {
  try {
    return format(template, ...(values ?? []))
  } catch {
    return values.length === 0 ? template : `${template} ${values.map(String).join(' ')}`
  }
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !(v instanceof Error) && !Array.isArray(v)
}

function summarizeValue(v: unknown, max = 2048): string {
  try {
    if (v === undefined) return ''
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
    const s = JSON.stringify(v)
    return s.length > max ? `${s.slice(0, max)}…` : s
  } catch {
    try {
      return String(v)
    } catch {
      return '[Object]'
    }
  }
}

/**
 * Builds the payload for {@link sendNewRelicLogEvent}; exported for deterministic unit tests only.
 *
 * Prefer {@link brainLogger}; do not POST manually — callers should use brainLogger APIs.
 */
export function buildBrainLogNrPayload(nrSeverity: NrSeverity, rawArgs: unknown[]): Record<string, unknown> {
  let message = ''
  let error: Error | undefined
  const extras: Record<string, unknown> = {}

  if (rawArgs.length > 0) {
    const a0 = rawArgs[0]
    const a1 = rawArgs[1]
    if (typeof a0 === 'string') {
      message = safeFormat(a0, rawArgs.slice(1))
    } else if (isPlainRecord(a0)) {
      for (const [k, val] of Object.entries(a0)) {
        extras[k] = val
      }
      const errRaw = extras.err ?? extras.error
      if (errRaw instanceof Error) {
        error = errRaw
        delete extras.err
        delete extras.error
      }

      const msgFromObj =
        typeof extras.msg === 'string'
          ? (extras.msg as string)
          : typeof extras.msg === 'number'
            ? String(extras.msg)
            : ''

      delete extras.msg

      if (typeof a1 === 'string') {
        message = safeFormat(a1, rawArgs.slice(2))
      } else if (msgFromObj) {
        message = msgFromObj
      } else {
        const keys = Object.keys(extras)
        message = keys.length === 0 ? '(object)' : `(${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', …' : ''})`
      }
    } else {
      message = String(a0)
      if (rawArgs.length > 1 && typeof rawArgs[1] === 'string') {
        message = safeFormat(rawArgs[1] as string, rawArgs.slice(2))
      }
    }
  }

  const flattened: Record<string, string | number | boolean> = {}
  let i = 0
  for (const [k, v] of Object.entries(extras)) {
    if (i >= 24) break
    if (k === 'message' || k === 'level' || k === 'timestamp') continue
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      v === undefined ||
      v === null
    ) {
      if (typeof v === 'string' && v.length > 2048) {
        flattened[`${k}`] = `${v.slice(0, 2048)}…`
      } else if (typeof v !== 'undefined' && v !== null) {
        flattened[k] = v as string | number | boolean
      }
    } else {
      flattened[k] = summarizeValue(v)
    }
    i++
  }

  const out: Record<string, unknown> = {
    message: message || '(brain)',
    level: nrSeverity,
    timestamp: Date.now(),
    ...flattened,
  }
  if (error) {
    out.error = error
  }
  return out
}

function sendNewRelicLogEvent(nrSeverity: NrSeverity, rawArgs: unknown[]): void {
  if (!newRelicIngestConfigured()) return
  try {
    const nr = require('newrelic') as { recordLogEvent?: (ev: Record<string, unknown>) => void }
    if (typeof nr.recordLogEvent !== 'function') return
    const payload = buildBrainLogNrPayload(nrSeverity, rawArgs)
    nr.recordLogEvent(payload)
  } catch {
    /* agent stub or recorder unavailable */
  }
}

type PinoLeafLevel = Extract<keyof Logger, 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'>

function delegate(nrSeverity: NrSeverity, leaf: PinoLeafLevel, rawArgs: unknown[]): void {
  ;(pinoSink[leaf] as (...a: unknown[]) => void).apply(pinoSink, rawArgs as never[])
  /** Match Pino’s level filter so NR does not receive lines that never hit stdout (default `LOG_LEVEL=info` drops `debug`). */
  if (!pinoSink.isLevelEnabled(leaf)) return
  sendNewRelicLogEvent(nrSeverity, rawArgs)
}

/**
 * Braintunnel logger: prints with Pino and also forwards to **`newrelic.recordLogEvent`**
 * when **`NEW_RELIC_LICENSE_KEY`** is set (same batching + correlation as agent API).
 * **`recordLogEvent`** runs only when Pino would emit at the current **`LOG_LEVEL`** (`isLevelEnabled`).
 *
 * Use at call sites explicitly — **no instrumentation / hooks**.
 */
export const brainLogger = {
  trace: (...args: unknown[]) => delegate('TRACE', 'trace', args),
  debug: (...args: unknown[]) => delegate('DEBUG', 'debug', args),
  info: (...args: unknown[]) => delegate('INFO', 'info', args),
  warn: (...args: unknown[]) => delegate('WARN', 'warn', args),
  error: (...args: unknown[]) => delegate('ERROR', 'error', args),
  fatal: (...args: unknown[]) => delegate('FATAL', 'fatal', args),
  /** Underlying bindings (e.g. `name: braintunnel`). */
  bindings: () => pinoSink.bindings(),
  /** Writable Pino log level (`trace` … `silent`). Same as `.level` setter on underlying logger. */
  get level(): string {
    return pinoSink.level
  },
  set level(val: string) {
    pinoSink.level = val as typeof pinoSink.level
  },
}
