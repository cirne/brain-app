import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as esbuild from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Ensures the production server bundle tree-shakes dev-only imports (Vite) and minifies.
 * Uses a temp outfile so we do not require `npm run build` before tests.
 */
describe('production server bundle (esbuild)', () => {
  let tmp: string | undefined
  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  })

  it('omits Vite dev server from the bundle when NODE_ENV is production', async () => {
    const root = process.cwd()
    tmp = await mkdtemp(join(tmpdir(), 'brain-prod-bundle-'))
    const outfile = join(tmp, 'index.js')
    await esbuild.build({
      absWorkingDir: root,
      entryPoints: [join(root, 'src/server/index.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      packages: 'external',
      minify: true,
      legalComments: 'none',
      sourcemap: false,
      define: {
        'process.env.NODE_ENV': '"production"',
      },
    })
    const s = readFileSync(outfile, 'utf8')
    expect(s).not.toMatch(/createViteServer/)
    expect(s).not.toMatch(/import\(['"]vite['"]\)/)
  })
})
