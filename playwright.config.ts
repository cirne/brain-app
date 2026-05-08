import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { loadRepoDotenv } from './tests/e2e/loadRepoDotenv'

/** Load `.env` before workers spawn so `BRAIN_ENRON_DEMO_SECRET` matches `npm run dev` with no shell export. */
loadRepoDotenv(dirname(fileURLToPath(import.meta.url)))

/**
 * E2E tests against **your usual dev server** — same `./data` and port **3000** as `npm run dev`.
 *
 * Prereqs:
 * - `npm run dev` running (`BRAIN_DATA_ROOT=./data` from [`scripts/run-dev.mjs`](scripts/run-dev.mjs)).
 * - Enron demo tenants under `./data/usr_enrondemo0000000000{1,2,3}/` via `npm run brain:seed-enron-demo:dev` once (`--all`) before Playwright (mint returns 503 if unprovisioned).
 * - Repo `.env` with non-empty `BRAIN_ENRON_DEMO_SECRET` (merged here automatically for Playwright; server loads `.env` on startup too). CI passes the secret via env instead.
 *
 * Optional: `PLAYWRIGHT_BASE_URL` if not using `http://127.0.0.1:3000`.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:3000'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
