/**
 * Side-effect import: load repo `.env` **before** other modules read `process.env`.
 * {@link https://github.com/nodejs/node/issues/47198 ESM evaluates static imports before module body},
 * so calling `loadDotEnv()` at the bottom of `index.ts` is too late for env read at module top level.
 */
import { loadDotEnv } from './loadDotEnv.js'

loadDotEnv()
