---
name: commit
description: Guides pre-commit verification, scoped lint/tests per package (Node app, ripmail, desktop/Tauri), i18n/copy checks for UI changes, test coverage expectations, then commit with an integration-safe push or merge path (single checkout or Git worktree). Use when the user invokes /commit, asks to commit, push, prepare a commit, or finish a change with git.
---

# Commit workflow (brain-app)

Single-maintainer, early development: **direct push to `main` is OK** once the steps below pass—**when `main` is the branch you are finishing**. In a **worktree** you are usually on a **feature branch**; integrate with upstream (`main`) before or as you publish, instead of assuming every session ends with `push origin main`.

## Node.js — `nvm use` first

The repo pins Node in **[`.nvmrc`](../../../.nvmrc)** (see **[`AGENTS.md`](../../../AGENTS.md)**). **Before any `npm`, `npx`, or `node` command** (including `npm run lint`, `npm run test`, `npm run ci`, `npm run ripmail:test`, and `npm rebuild`), run from the **root of this checkout** (the directory that contains `.nvmrc`—either the primary clone **or** a linked worktree):

```sh
nvm use
```

In non-interactive shells (agents, CI scripts), load nvm first if needed (e.g. `source ~/.nvm/nvm.sh`), then `nvm use`. Wrong Node causes native addon mismatches (e.g. `better-sqlite3`) and invalid test results.

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

## 2b. i18n & copy (UI changes)

When the diff touches **user-visible UI** (typically `src/client/**/*.svelte`, or client code that renders labels, buttons, empty states, errors, or banners):

- **Internationalization**: User-facing strings belong in locale JSON, wired through the client i18n layer (e.g. `t` from [`@client/lib/i18n/index.js`](../../../src/client/lib/i18n/index.js)). Do not leave new product copy as hard-coded literals in components unless the codebase already documents an exception (e.g. purely technical/debug surfaces).
- **Where strings live**: English source files are under [`src/client/lib/i18n/locales/en/`](../../../src/client/lib/i18n/locales/en/) (`common.json`, `chat.json`, `nav.json`, `inbox.json`, etc.). Pick the existing module that matches the feature; add keys alongside similar strings and keep structure consistent with that file.
- **Copy quality**: Wording must follow **[`docs/COPY_STYLE_GUIDE.md`](../../../docs/COPY_STYLE_GUIDE.md)**—voice/tone, no-plumbing rule, **Braintunnel** as the product name in UI, **vault** vs **wiki**, and desktop vs hosted accuracy.

**Skip this subsection** when the change is server-only, Rust-only, scripts-only, or otherwise does not add or alter user-visible copy.

## 3. Commands (scoped)

Run only what applies to the packages identified above. **Run `nvm use` at this checkout root before the Node/npm lines below.**

**Node app**

- `npm run lint`
- When **`package-lock.json`** or **`shared/npm-known-malware.json`** changes (or new npm deps are added): `npm run check:npm-malware` (also runs inside `npm run ci`)
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

## 4. Commit when green, then integrate (push and/or merge)

1. Confirm the relevant commands above exited **0**.
2. Commit with a **clear message** (Conventional Commits encouraged: `feat:`, `fix:`, `refactor:`, etc.).
3. **See which branch you are on**: `git branch --show-current` (and optionally `git worktree list` if you manage multiple checkouts).

**If you are on `main`**

- Prefer **fast-forward safety** before pushing: `git fetch origin` and reconcile (`git pull --ff-only` or rebase **only if** that matches how this repo normally tracks `origin/main`).
- Then `git push` (to `origin main`).

**If you are not on `main`** (common in a **worktree**)

- **Update from upstream** before pushing your branch (reduces surprises and integrates like a sane “done with this worktree” step):

```sh
git fetch origin
git rebase origin/main   # resolve any conflicts here; alternative: git merge origin/main
```

  Use the integration branch name your team tracks if it is not `main` (e.g. `develop`).

- **Publish the branch** (not `main`): `git push -u origin HEAD` (first time) or `git push` (if upstream is already set).

- **Land the work** according to repo habit:
  - **PR / review**: open or update a PR from that branch and merge via hosting (typical when others might review).
  - **Local-first / maintainer solo**: merge from the checkout that has **`main`** checked out (`git checkout main && git merge <feature>` or `git merge --ff-only` after updating `main`), then `git push origin main`. You can merge from whichever machine has **`main`** (often the **primary** worktree path, not the feature worktree)—Git does not require merging from the feature worktree directory itself.

Do not commit secrets or large generated artifacts; match existing `.gitignore` conventions.

## Worktrees (Git)

- **`git worktree list`** shows path → branch bindings. **`git rev-parse --show-toplevel`** is the checkout root—run `nvm use` **there** (`./data`/`BRAIN_HOME` etc. paths are clone-specific; do not merge local data across worktrees blindly).
- A second worktree checks out **another branch** in parallel; **`git push` pushes whatever branch that worktree has checked out**.
- Git **refuses two worktrees checking out the same branch** until you detach or swap—respect that constraint.
- **Removing a finished worktree** is done from **any** clone of the repo, usually **after** the branch is merged and no longer needed:

```sh
git worktree remove /path/to/worktree   # or: git worktree remove --force ... if dirty and user accepts loss
```

  Do **not** `rm -rf` a worktree directory without `git worktree remove` (or you leave stale metadata). Only remove when the user wants that cleanup.

- If the user has not set `origin` or does not want to push yet, stop after **commit + rebase/merge with `origin/main`** and report status; do not assume **push** is always the next step.

## Quick checklist

```
- [ ] `nvm use` at this checkout root before npm/node (see above)
- [ ] Changed packages identified
- [ ] Tests added/updated per package (incl. regression tests for bug fixes)
- [ ] UI changes: i18n keys in `src/client/lib/i18n/locales/en/*.json`, copy matches `docs/COPY_STYLE_GUIDE.md`
- [ ] Scoped lint/tests (or full ci) all green
- [ ] Commit message; branch-aware integration (fetch + rebase/merge onto upstream if not main; push branch or main per workflow)
```
