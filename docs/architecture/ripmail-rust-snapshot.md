# Rust ripmail — recoverable git snapshot (pre–TypeScript port)

Braintunnel’s inbox stack **used to** live in the **`ripmail/`** Cargo crate (Rust CLI + subprocess from Node). **`main` today** runs the same responsibilities in **`src/server/ripmail/`** (TypeScript, in-process `better-sqlite3`); the Rust crate is **not** on the default branch anymore. This page keeps **annotated git tags** for checking out the last **Rust-first** tree (archaeology, diffs, regression comparison) and records **CI/release** notes from the cutover.

**Canonical opportunity context:** [OPP-103](../opportunities/OPP-103-ripmail-ts-port.md) · **Indexed record:** [archived OPP-105](../opportunities/archive/OPP-105-ripmail-rust-pre-typescript-git-snapshot.md)

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

At that snapshot, Rust sources and decisions live under **`ripmail/`** (e.g. `ripmail/docs/ARCHITECTURE.md` in that checkout). The server spawned the **`ripmail`** CLI and desktop builds compiled **`cargo build -p ripmail --release`**. On current `main`, mail runs in **`src/server/ripmail/`**; layout: [shared/brain-layout.json](../../shared/brain-layout.json), overview: [AGENTS.md](../../AGENTS.md).

---

## Related docs (on this tag)

- **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)** — app-level index; **Ripmail** row links here.
- **[architecture/integrations.md](./integrations.md)** — trust boundaries for mail vs `chat.db` (current `main`).

---

## CI and release checklist (cutover — largely complete)

**As of 2026-05**, default-branch **[`ci.yml`](../../.github/workflows/ci.yml)** no longer builds or publishes a Linux **`ripmail`** ELF; Docker and Enron workflows assume the **TypeScript** stack. Use the table below only when auditing stragglers (old docs, `ripmail-latest` consumers, desktop bundle scripts).

| Area | Status / notes |
|------|----------------|
| **[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)** | **Done:** `ripmail` / `ripmail-release` jobs and Docker’s “build ripmail ELF” step removed. |
| **[`.github/workflows/e2e-enron.yml`](../../.github/workflows/e2e-enron.yml)** | **Done:** Vitest + Playwright use Node + TS mail paths (no `cargo build -p ripmail`). |
| **[`CLOUD-AGENTS.md`](../../CLOUD-AGENTS.md)** | **Done for cloud:** in-process mail; see doc for historical **`ripmail-latest`** note. |
| **[`package.json`](../../package.json)** | **Done:** `ripmail:*` / `docker:ripmail:build` scripts removed with the port. |
| **Desktop / Tauri** | **`desktop:bundle-server`** should **not** expect a `ripmail` binary in `server-bundle/` (see [archive/OPP-007-native-mac-app.md](../opportunities/archive/OPP-007-native-mac-app.md), root `package.json`); verify release docs match whatever the bundle ships. |

**Last Rust binary on GitHub Releases:** rolling tag **`ripmail-latest`** may still point at the **final pre-port** `ripmail-linux-x86_64` asset until releases are cleaned up manually.
