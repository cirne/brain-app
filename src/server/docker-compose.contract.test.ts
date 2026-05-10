import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('Docker packaging (OPP-041 Phase 1)', () => {
  it('docker-compose wires .env and container BRAIN_DATA_ROOT', () => {
    const raw = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf-8')
    expect(raw).toMatch(/env_file:\s*\n\s*-\s*\.env/m)
    expect(raw).toMatch(/BRAIN_DATA_ROOT:\s*\/brain-data/)
    expect(raw).not.toMatch(/RIPMAIL_BIN:/)
    expect(raw).toContain('brain_data:/brain-data')
    expect(raw).toMatch(/PORT:\s*["']?4000["']?/)
    expect(raw).toMatch(/\$\{BRAIN_DOCKER_PORT:-4000\}:4000/)
  })

  it('Dockerfile builds production Node bundle (no ripmail binary)', () => {
    const raw = readFileSync(join(repoRoot, 'Dockerfile'), 'utf-8')
    expect(raw).not.toMatch(/linux-ripmail/)
    expect(raw).not.toMatch(/RIPMAIL_BIN/)
    expect(raw).not.toMatch(/cargo build -p ripmail/)
    expect(raw).toMatch(/npm run build/)
    expect(raw).toMatch(/ENV PORT=4000/)
    expect(raw).toContain('CMD ["node", "dist/server/index.js"]')
  })

  it('package.json docker scripts build the image directly', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.start).toBe('node dist/server/index.js')
    expect(pkg.scripts['docker:ripmail:build']).toBeUndefined()
    expect(pkg.scripts['docker:up']).toBe('docker compose up --build')
    expect(pkg.scripts['docker:build']).toBe('docker build -t brain-app:local .')
    expect(pkg.scripts['docker:deploy']).toBe('bash scripts/docker-deploy-do.sh')
  })

  it('server bundle copies ripmail default rules beside dist/server/index.js', () => {
    const raw = readFileSync(join(repoRoot, 'scripts/build-server-bundle.mjs'), 'utf-8')
    expect(raw).toContain('src/server/ripmail/rules')
    expect(raw).toMatch(/join\(outdir, ['"]rules['"]\)/)
  })
})
