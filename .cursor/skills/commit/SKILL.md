---
name: commit
description: Guides pre-commit verification, scoped lint/tests per package (Node app, ripmail, desktop/Tauri), test coverage expectations, then commit and push to main when green. Use when the user invokes /commit, asks to commit, push, prepare a commit, or finish a change with git.
---

# Commit workflow (brain-app)

Single-maintainer, early development: **direct push to `main` is OK** once the steps below pass.

## 1. Classify touched packages

Use staged or unstaged paths (e.g. `git diff --name-only` / `git status`). Map paths to packages:

| Package | Path patterns |
|--------|----------------|
| **Node app** | `src/`, `scripts/`, root `package.json`, `package-lock.json`, `vite*.ts`, `tsconfig*.json`, `eslint.config.*`, `index.html`, other root JS tooling |
| **ripmail** | `ripmail/` |
| **Desktop (Tauri)** | `desktop/` |

**Also treat as relevant:**

- **`Cargo.toml` (repo root)** or **workspace-wide** Rust changes → run checks for **both** Rust members (`ripmail` and desktop).
- **Cross-cutting scripts** (e.g. `scripts/bundle-tauri-server.mjs`) → include **Node** plus any **Rust** package the script integrates with.

If multiple packages are touched, run the union of their checks. If classification is ambiguous, run `npm run ci` (full pipeline).

## 2. Tests before commit

For **each** package that changed:

- **New or changed behavior** → add or update **automated tests** in that package.
- **Bug fixes** → add a **regression test** that fails without the fix and passes with it (TDD-style when practical).

**Where tests live:**

- Node: `src/**/*.test.ts` (Vitest).
- Rust: tests in the relevant crate (`ripmail/`, `desktop/`).

Docs-only or comment-only edits: skip new tests unless they document behavior that should be tested elsewhere.

## 3. Commands (scoped)

Run only what applies to the packages identified above.

**Node app**

- `npm run lint`
- `npm run typecheck`
- `npm run test`

**ripmail** (`cargo` package `ripmail`)

- `cargo fmt -p ripmail -- --check`
- `cargo clippy -p ripmail -- -D warnings`
- `npm run ripmail:test` (or `cargo test -p ripmail`)

**Desktop / Tauri** (folder `desktop/`, Cargo package name **`app`**)

- `cargo fmt -p brain -- --check`
- `cargo clippy -p brain -- -D warnings`
- `cargo test -p brain`

**Full repo** (when in doubt or `npm run ci` requested)

- `npm run ci` — lint, typecheck, Node tests, then `cargo fmt` + `cargo clippy` + `cargo test` for the Rust workspace (see `package.json`).

## 4. Commit and push when green

1. Confirm the relevant commands above exited **0**.
2. Commit with a **clear message** (Conventional Commits encouraged: `feat:`, `fix:`, `refactor:`, etc.).
3. `git push` to **`main`** (or the current branch if not `main`).

Do not commit secrets or large generated artifacts; match existing `.gitignore` conventions.

## Quick checklist

```
- [ ] Changed packages identified
- [ ] Tests added/updated per package (incl. regression tests for bug fixes)
- [ ] Scoped lint/tests (or full ci) all green
- [ ] Commit message + push
```
