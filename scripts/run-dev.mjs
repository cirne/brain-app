#!/usr/bin/env node
/**
 * Starts `tsx watch` for the Hono server. If `RIPMAIL_BIN` is unset, prefer a
 * workspace Cargo artifact so Braintunnel uses the same ripmail as this repo (debug
 * if present, else release after `npm run ripmail:build`) instead of whatever
 * is on PATH.
 */
import { spawnDevServer } from './run-dev-common.mjs'

spawnDevServer()
