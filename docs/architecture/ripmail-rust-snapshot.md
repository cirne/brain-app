# Rust ripmail — recoverable git snapshot (pre–TypeScript port)

Braintunnel’s inbox stack historically lived in the **`ripmail/`** Cargo crate (Rust CLI + SQLite + subprocess from Node). **[OPP-103](../opportunities/OPP-103-unified-tenant-sqlite-and-ripmail-ts-port.md)** ports that logic to TypeScript and merges the mail index into tenant SQLite. After that cutover, the Rust tree may shrink or leave the default branch, so this page records an **annotated git tag** you can use to check out the last **Rust-first** layout for archaeology, diffs, or emergency reference.

**Canonical opportunity context:** [OPP-103](../opportunities/OPP-103-unified-tenant-sqlite-and-ripmail-ts-port.md) · **Indexed record:** [archived OPP-105](../opportunities/archive/OPP-105-ripmail-rust-pre-typescript-git-snapshot.md)

---

## Tags

| Tag | Commit (full) | Notes |
|-----|-----------------|--------|
| `ripmail-rust-before-typescript-port` | `4d307275a0ea6efa23688a1625e06d6d5f90496b` | First annotated snapshot (docs-only commit at the time). **Rust `ripmail/` tree matches later `main` through the TS cutover** — no Rust changes landed on `main` after this commit until the port branch removes the crate. |
| `ripmail-rust-snapshot-2026-05-10` | `298f4a260814323462d3966fdcc8dfbe134767eb` | **Immutable “last `main` before Rust deletion”** — same `ripmail/` directory tree as the row above; `main` gained TypeScript-only work after the first tag. |

The first tag message is: *Snapshot: Rust ripmail on main before TypeScript port.* The second: *Last main commit before ripmail Rust removal (immutable snapshot; same ripmail/ tree as ripmail-rust-before-typescript-port).*

---

## Recover the tree

From any clone:

```bash
git fetch origin tag ripmail-rust-before-typescript-port
git switch --detach ripmail-rust-before-typescript-port
```

For the **latest pre-delete `main` tip** (recommended if you want collaboration / notification changes that landed after the first tag):

```bash
git fetch origin tag ripmail-rust-snapshot-2026-05-10
git switch --detach ripmail-rust-snapshot-2026-05-10
```

To work on a branch from either snapshot:

```bash
git fetch origin tag ripmail-rust-snapshot-2026-05-10
git switch -c recover-rust-ripmail ripmail-rust-snapshot-2026-05-10
```

At that snapshot, Rust sources and decisions live under **`ripmail/`** (e.g. `ripmail/docs/ARCHITECTURE.md` in that checkout). The server spawned the **`ripmail`** CLI and desktop builds compiled **`cargo build -p ripmail --release`**. On current `main`, mail runs in **`src/server/ripmail/`**; see [AGENTS.md](../../AGENTS.md).

---

## Related docs (on this tag)

- **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)** — app-level index; **Ripmail** row links here.
- **[architecture/integrations.md](./integrations.md)** — subprocess + trust boundaries (evolves after TS port).

---

## After the TypeScript port merge — CI and release checklist

When **`ripmail/`** leaves the default branch ([OPP-103](../opportunities/OPP-103-unified-tenant-sqlite-and-ripmail-ts-port.md)), update automation and contributor docs so nothing still assumes a Cargo-built Linux binary.

| Area | What to change |
|------|----------------|
| **[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)** | Remove or replace the **`ripmail`** job (`cargo fmt` / `clippy` / `nextest` for `-p ripmail`). Remove **`ripmail-release`** (`softprops/action-gh-release`, rolling tag `ripmail-latest`). In **`docker`**, drop the “Build ripmail (Linux)” step unless the Dockerfile still needs a sidecar binary (post-port Docker should match the new layout). |
| **[`.github/workflows/e2e-enron.yml`](../../.github/workflows/e2e-enron.yml)** | Replace `cargo build -p ripmail --release` with whatever invokes the **TS mail CLI** (or document that Enron E2E requires a prebuilt `RIPMAIL_BIN` / in-repo runner). |
| **[`CLOUD-AGENTS.md`](../../CLOUD-AGENTS.md)** | Replace “download `ripmail-linux-x86_64` from `ripmail-latest`” with the **post-port** setup (e.g. no separate binary, or a new artifact name and release tag). |
| **[`package.json`](../../package.json)** | Remove or repurpose `ripmail:*` and **`docker:ripmail:build`** / **`scripts/docker-prebuild-ripmail.ts`** if Docker no longer copies a Rust artifact into `.docker/linux-ripmail/`. |
| **Desktop / Tauri** | **`desktop:bundle-server`** and release docs in **AGENTS.md** should describe bundling the **TS** implementation (or dropping the separate `ripmail` binary from the bundle) — tracked on the port branch. |

**Last Rust binary on GitHub Releases:** the `ripmail-latest` asset published by `ripmail-release` remains the **final pre-port Linux x86_64** build until a push to `main` after the workflow is removed or repurposed.
