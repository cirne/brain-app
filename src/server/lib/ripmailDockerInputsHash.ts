import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * Files that affect `cargo build -p ripmail --release` for Docker (workspace + ripmail crate).
 * Used to skip redundant container builds when publishing repeatedly.
 */
export function listRipmailDockerInputPaths(repoRoot: string): string[] {
  const git = spawnSync('git', ['ls-files', 'Cargo.toml', 'Cargo.lock', 'ripmail'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  })
  if (git.status === 0 && git.stdout) {
    const paths = git.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    if (paths.length > 0) {
      // Paths still listed by Git after an unstaged working-tree delete cause ENOENT
      // below; Cargo only reads the filesystem, so hash what exists on disk.
      return paths.filter((p) => existsSync(join(repoRoot, p)))
    }
  }

  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'target' || name === '.git') continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else out.push(relative(repoRoot, full))
    }
  }
  for (const f of ['Cargo.toml', 'Cargo.lock']) {
    try {
      statSync(join(repoRoot, f))
      out.push(f)
    } catch {
      /* skip */
    }
  }
  walk(join(repoRoot, 'ripmail'))
  return [...new Set(out)].sort((a, b) => a.localeCompare(b))
}

export function computeRipmailDockerInputsHash(repoRoot: string): string {
  const paths = listRipmailDockerInputPaths(repoRoot)
  const h = createHash('sha256')
  for (const p of paths) {
    const full = join(repoRoot, p)
    h.update(p, 'utf8')
    h.update('\0')
    h.update(readFileSync(full))
    h.update('\0')
  }
  return `sha256:${h.digest('hex')}`
}
