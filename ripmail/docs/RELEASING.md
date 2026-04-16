# Releasing ripmail (Rust binary via GitHub Releases)

This document is the **maintainer guide** for shipping a new **Rust/Cargo** version: prebuilt binaries on GitHub Releases and `install.sh` stable installs. It does **not** cover npm publishing.

## Version source of truth

- **[`Cargo.toml`](../Cargo.toml)** field `version` is embedded in the binary as `CARGO_PKG_VERSION` (see [`src/main.rs`](../src/main.rs)); users see it as `ripmail --version` / `ripmail -V`.

## Versioning policy (milestones vs routine cuts)

Cargo requires a valid **semver** string. This project uses two rhythms:

- **Significant release (milestone):** bump **`MAJOR.MINOR.PATCH`** when the change is user-visible or worth a clear version line (e.g. `0.2.0`, or `0.1.10`). You may ship it as a bare stable tag (`v0.1.10` → `version = "0.1.10"`).
- **Routine binary cut:** keep the current milestone and append a **prerelease** segment **`-YYYYMMDD.HHMMSS` in UTC** (e.g. `0.1.9-20260413.194512`). Use this for packaging-only work, CI fixes, or small churn between milestones—**without** burning another patch number for every artifact.

**Semver ordering caveat:** `0.1.9` (no prerelease) sorts **newer than** any `0.1.9-*`. If you already published a **bare** `0.1.9` release, the next datetime-suffixed cut must bump the milestone first (e.g. `0.1.10-20260414.120000`) or bump to a new bare `0.1.10`. Prefer **`-`** suffixes; avoid relying on `+` build metadata in tags (awkward in Git).

## Invariant

The git tag **must** match the crate version:

- Tag: **`v` + exact semver from `Cargo.toml`** (e.g. `v0.2.0`, `v0.1.9-20260413.194512`). Cargo has no leading `v` in `version = "…"`.
- **Same commit** must have that `version = "…"` in `Cargo.toml`.

If the tag points at an older commit that still has the previous `Cargo.toml` version, the GitHub Release assets will **not** match what `ripmail --version` reports.

## What triggers CI

[`.github/workflows/release-builds.yml`](../.github/workflows/release-builds.yml) (**Binary builds**):

- **`push`** of tags matching `v[0-9]*` — builds Linux (x86_64 + aarch64), macOS ARM, Windows packages, attaches artifacts, and creates/updates a **GitHub Release** (release notes generated for tag pushes).
- **`schedule`** (daily UTC) — same build matrix, publishes prerelease artifacts to the fixed tag **`nightly`**.
- **`workflow_dispatch`** — manual test builds with a custom version label; use **Create GitHub Release** only when intentionally testing that path. For real releases, **push a `v*` tag** instead.

End users install nightlies with `install.sh --nightly` (see [`AGENTS.md`](../AGENTS.md)). The GitHub Release **`published_at`** for tag **`nightly`** does not refresh when artifacts are replaced; use the release body line **Artifacts built (UTC)**, or the API field **`updated_at`**, to see when the last build landed (see [`.cursor/skills/release/SKILL.md`](../.cursor/skills/release/SKILL.md)).

## Artifacts and `install.sh`

The workflow sets `RELEASE_VERSION` to the **tag name** (e.g. `v0.2.0` or `v0.1.9-20260413.194512`). Archives are named:

`ripmail-{RELEASE_VERSION}-{target}.{tar.gz|zip}`

Stable install pins a tag:

```bash
bash install.sh --version v0.2.0
bash install.sh --version v0.1.9-20260413.194512
# or: RIPMAIL_VERSION=v0.2.0 bash install.sh
```

See [`install.sh`](../install.sh) (`--version` / `pick_stable_asset`).

## Release checklist

Run from the **repository root**:

1. **Quality bar** (same as contributor pre-merge):

   ```bash
   cargo fmt --all -- --check
   cargo clippy --all-targets -- -D warnings
   cargo test
   ```

2. Set **`Cargo.toml`** `version` per [Versioning policy](#versioning-policy-milestones-vs-routine-cuts): milestone bump (`0.2.0`) or routine prerelease (`0.1.9-20260413.194512` UTC).

3. **Commit** and **push** the branch (e.g. `main`) so the commit exists on the remote.

4. **Tag** that commit and push the tag (name must match **`v` + `version`**):

   ```bash
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   # e.g. routine:  git tag -a v0.1.9-20260413.194512 -m "v0.1.9-20260413.194512"
   ```

   Optional: signed tag with `git tag -s`.

5. **Wait for** the **Binary builds** workflow to finish on GitHub.

6. **Verify:**
   - Release includes per-triple archives and **`SHA256SUMS`**.
   - `bash install.sh --version v0.2.0` or `bash install.sh --version v0.1.9-20260413.194512` (from a clone or via `curl` raw URL) installs successfully.
   - Installed binary: `ripmail --version` matches **`Cargo.toml`**.

## Troubleshooting

- **Wrong version in binary:** Tag likely points at a commit before the `Cargo.toml` bump; delete the remote tag only if no one depends on it, fix the commit graph, and re-tag per project policy.
- **Workflow failed:** Fix the cause on `main`, then either move the tag (only if safe) or cut `vX.Y.Z+1` with a new patch/minor bump.
- **Local smoke (static musl Linux):** install [`cross`](https://github.com/cross-rs/cross) and run `cross build --release --target x86_64-unknown-linux-musl` / `aarch64-unknown-linux-musl` as in [`.github/workflows/release-builds.yml`](../.github/workflows/release-builds.yml). macOS cannot reproduce the Linux link layout; use `workflow_dispatch` or an Ubuntu container with Docker.

## See also

- [`.github/workflows/release-builds.yml`](../.github/workflows/release-builds.yml) — versioned releases, nightly prerelease, and manual test bundles  
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — fmt, clippy, tests, release build smoke  
- [`install.sh`](../install.sh) — end-user installer for Release assets  
- [`AGENTS.md`](../AGENTS.md) — install, env, and dev commands  
- [`.cursor/skills/commit/SKILL.md`](../.cursor/skills/commit/SKILL.md) — pre-commit quality checklist  
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — technical context and ADRs  
- [`RUST_PORT.md`](RUST_PORT.md) — parity tracker and packaging notes  
- [`opportunities/archive/OPP-030-rust-port-cutover.md`](opportunities/archive/OPP-030-rust-port-cutover.md) — cutover sequencing  
