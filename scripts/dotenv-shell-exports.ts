/**
 * Used by `docker-deploy-do.sh`: load `.env` from cwd via `loadDotEnv()` (same rules as the Hono server),
 * then print `export KEY=…` lines for variables the deploy script reads (bash `eval`).
 */
import { loadDotEnv } from '../src/server/lib/platform/loadDotEnv'

const KEYS = [
  'NEW_RELIC_API_KEY',
  'NEW_RELIC_DEPLOY_USER',
  'DOCKER_IMAGE_TAG',
  'DOCKER_PUBLISH_LATEST',
  'DOCKER_PUBLISH_PLATFORM',
  'OPENAI_API_KEY',
  'RELEASE_NOTES_MODEL',
] as const

loadDotEnv()
for (const name of KEYS) {
  const v = process.env[name]
  if (v !== undefined && v !== '') {
    process.stdout.write(`export ${name}=${JSON.stringify(v)}\n`)
  }
}
