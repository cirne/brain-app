# Validating Installation

**Scope:** Validate the **Rust binary** installer at the repository root (`install.sh`) and smoke-test a local build. **Shipping a versioned release** (tag, GitHub Releases, `install.sh --version`) is documented in **[RELEASING.md](RELEASING.md)**.

**Historical:** npm publish and `node/scripts/*` existed before the Node implementation was removed; use **git history** if you need those procedures.

## Install script (root `install.sh`)

The script is **standalone** (Python embedded in bash) and downloads prebuilt **Rust** binaries from GitHub Releases. It does **not** require Node or npm.

### Quick checks

```bash
bash -n install.sh
# Optional: brew install shellcheck
shellcheck install.sh
```

### End-to-end

```bash
curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash
ripmail --version
ripmail --help
```

## Local build smoke test

From the repository root:

```bash
cargo test
cargo build --release
./target/release/ripmail --help
```

Or use **`cargo install-local`** (see [AGENTS.md](../AGENTS.md)) to install to a prefix and link the publishable skill.

## Pre-release checklist (maintainers)

- [ ] `bash -n install.sh` passes
- [ ] `shellcheck install.sh` passes (if ShellCheck installed)
- [ ] `cargo fmt`, `cargo clippy`, `cargo test` pass at repo root
- [ ] Release process in [RELEASING.md](RELEASING.md) followed for versioned binaries
