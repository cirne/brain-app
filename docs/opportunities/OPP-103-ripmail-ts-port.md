# OPP-103: Ripmail TypeScript port (moved)

**This work shipped (2026-05-11).** Mail runs **in-process** in **`src/server/ripmail/`** (`better-sqlite3` on `<tenant>/ripmail/ripmail.db`). Hub refresh/backfill and agent mail tools use this runtime directly; the Rust **`ripmail/`** crate is not on **`main`**.

- **Rust archaeology:** [architecture/ripmail-rust-snapshot.md](../architecture/ripmail-rust-snapshot.md) · [archived OPP-105](archive/OPP-105-ripmail-rust-pre-typescript-git-snapshot.md)
- **Follow-on (one DB per tenant):** [OPP-108](OPP-108-unified-tenant-sqlite.md)
- **Full historical spec:** [archive/OPP-103-ripmail-ts-port.md](archive/OPP-103-ripmail-ts-port.md)
