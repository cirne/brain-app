/**
 * Side-effect import: load repo `.env` **before** other modules read `process.env`.
 * {@link https://github.com/nodejs/node/issues/47198 ESM evaluates static imports before module body},
 * so calling `loadDotEnv()` at the bottom of `index.ts` is too late for flags imported transitively (e.g. `features.ts`).
 */
import { loadDotEnv } from './loadDotEnv.js'

loadDotEnv()
