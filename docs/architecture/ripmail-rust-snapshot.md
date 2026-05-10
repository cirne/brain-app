# Rust ripmail — recoverable git snapshot (pre–TypeScript port)

Braintunnel’s inbox stack historically lived in the **`ripmail/`** Cargo crate (Rust CLI + SQLite + subprocess from Node). **[OPP-103](../opportunities/OPP-103-unified-tenant-sqlite-and-ripmail-ts-port.md)** ports that logic to TypeScript and merges the mail index into tenant SQLite. After that cutover, the Rust tree may shrink or leave the default branch, so this page records an **annotated git tag** you can use to check out the last **Rust-first** layout for archaeology, diffs, or emergency reference.

**Canonical opportunity context:** [OPP-103](../opportunities/OPP-103-unified-tenant-sqlite-and-ripmail-ts-port.md) · **Indexed record:** [archived OPP-105](../opportunities/archive/OPP-105-ripmail-rust-pre-typescript-git-snapshot.md)

---

## Tag

| Field | Value |
|--------|--------|
| **Tag name** | `ripmail-rust-before-typescript-port` |
| **Points at** | `main` @ `4d307275a0ea6efa23688a1625e06d6d5f90496b` (short: `4d307275`) |
| **Tagged** | 2026-05-10 (Pacific) |

The tag message is: *Snapshot: Rust ripmail on main before TypeScript port.*

---

## Recover the tree

From any clone:

```bash
git fetch origin tag ripmail-rust-before-typescript-port
git switch --detach ripmail-rust-before-typescript-port
```

To work on a branch from that commit:

```bash
git fetch origin tag ripmail-rust-before-typescript-port
git switch -c recover-rust-ripmail ripmail-rust-before-typescript-port
```

At that snapshot, Rust sources and decisions are under **`ripmail/`** (see [`ripmail/docs/ARCHITECTURE.md`](../../ripmail/docs/ARCHITECTURE.md) on that revision). The brain-app server still spawns **`ripmail`** as a subprocess; desktop release flow still builds **`cargo build -p ripmail --release`** into `server-bundle/` — that wiring is described in [AGENTS.md](../../AGENTS.md) for that revision.

---

## Related docs (on this tag)

- **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)** — app-level index; **Ripmail** row links here.
- **[architecture/integrations.md](./integrations.md)** — subprocess + trust boundaries (evolves after TS port).
