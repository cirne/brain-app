import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getBrainLayout } from '@server/lib/platform/brainLayout.js'

/** Written under local `BRAIN_HOME` after OPP-024 migration runs (or is a no-op). */
export const OPP024_SPLIT_MARKER = '.brain-split-layout-v1'

async function dirHasUserContent(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.name === '.git') continue
    return true
  }
  return false
}

async function movePath(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  try {
    await rename(src, dest)
  } catch (e: unknown) {
    const code =
      e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string'
        ? (e as { code: string }).code
        : undefined
    if (code === 'EXDEV') {
      await cp(src, dest, { recursive: true, force: true })
      await rm(src, { recursive: true, force: true })
    } else {
      throw e
    }
  }
}

export interface Opp024MigrationPaths {
  localRoot: string
  legacyWiki: string
  targetWiki: string
  wikiDirName: string
}

/**
 * One-time move of pre–OPP-024 wiki from `Application Support/.../wiki` to the synced tree.
 * Exported for unit tests; production uses {@link runSplitLayoutMigrationIfNeeded}.
 */
export async function migrateOpp024WikiFromLegacy(opts: Opp024MigrationPaths): Promise<void> {
  const { localRoot, legacyWiki, targetWiki, wikiDirName } = opts
  const marker = join(localRoot, OPP024_SPLIT_MARKER)
  if (existsSync(marker)) return

  if (!existsSync(legacyWiki)) {
    await writeFile(marker, `completedAt=${new Date().toISOString()}\n`, 'utf-8')
    return
  }

  const legacyNonEmpty = await dirHasUserContent(legacyWiki)
  const targetExists = existsSync(targetWiki)
  const targetNonEmpty = targetExists ? await dirHasUserContent(targetWiki) : false

  if (!targetExists) {
    await mkdir(dirname(targetWiki), { recursive: true })
    await movePath(legacyWiki, targetWiki)
    await writeFile(marker, `migratedAt=${new Date().toISOString()}\n`, 'utf-8')
    console.log(`[brain-app] OPP-024: migrated wiki → ${targetWiki}`)
    return
  }

  if (!targetNonEmpty && legacyNonEmpty) {
    await rm(targetWiki, { recursive: true, force: true })
    await movePath(legacyWiki, targetWiki)
    await writeFile(marker, `migratedAt=${new Date().toISOString()}\n`, 'utf-8')
    console.log(`[brain-app] OPP-024: migrated wiki → ${targetWiki}`)
    return
  }

  if (legacyNonEmpty && targetNonEmpty) {
    const escapeName = `${wikiDirName}-legacy-from-app-support`
    const escape = join(localRoot, escapeName)
    await movePath(legacyWiki, escape)
    console.warn(
      `[brain-app] OPP-024: wiki existed in both Application Support and Documents; moved legacy to ${escape}`,
    )
  } else if (legacyNonEmpty) {
    await movePath(legacyWiki, targetWiki)
    console.log(`[brain-app] OPP-024: migrated wiki → ${targetWiki}`)
  } else {
    await rm(legacyWiki, { recursive: true, force: true })
  }

  await writeFile(marker, `completedAt=${new Date().toISOString()}\n`, 'utf-8')
}

export async function runSplitLayoutMigrationIfNeeded(): Promise<void> {
  if (process.env.BRAIN_BUNDLED_NATIVE !== '1' || process.platform !== 'darwin') {
    return
  }
  const { brainHome, wikiContentDir } = await import('@server/lib/platform/brainHome.js')
  const local = brainHome()
  const layout = getBrainLayout()
  const legacyWiki = join(local, layout.directories.wiki)
  const targetWiki = wikiContentDir()

  await migrateOpp024WikiFromLegacy({
    localRoot: local,
    legacyWiki,
    targetWiki,
    wikiDirName: layout.directories.wiki,
  })
}
