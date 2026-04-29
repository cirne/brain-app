import pino from 'pino'
import { isDevRuntime } from '@server/lib/platform/isDevRuntime.js'

const isDev = isDevRuntime()

/** Shared server logger; name appears in every line. New Relic forwards JSON logs in production. */
export const logger = pino({
  name: 'braintunnel',
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, singleLine: true },
    },
  }),
})
