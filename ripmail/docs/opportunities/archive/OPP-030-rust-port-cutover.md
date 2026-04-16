# OPP-030: Rust Port — Packaging and Cutover

**Status:** Archived — mostly implemented. **Archived:** 2026-04-10. Rust-only in-repo cutover done; optional npm deprecation and doc polish remain in this doc.

**Cutover complete (in-repo)** — the TypeScript **`node/`** tree and parallel implementation are **removed**. Default install is **`install.sh`** → GitHub Release binaries; **`AGENTS.md`** and **`skills/ripmail/`** lead with that path. **Remaining (external / optional):** deprecate **`@cirne/zmail`** on npm if it still exists; point users to **`install.sh`**.

**Canonical technical context:** [ADR-025](../ARCHITECTURE.md#adr-025-rust-port--parallel-implementation-pre-cutover) — Rust-only implementation, integration tests at crate root. **Post-cutover tracker:** [RUST_PORT.md](../RUST_PORT.md).

**Completed:**

1. **CI:** `cargo clippy` + `cargo test` at the **repository root** on every PR ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).
2. **Single implementation:** Rust CLI + MCP; historical Node code preserved only in **git history**.
3. **Docs / skill:** Binary-first install; **`node/`** dev commands removed from **`AGENTS.md`** and **`README.md`**.

**Non-goals:** Maintaining two implementations or npm publish workflows in this repository.
