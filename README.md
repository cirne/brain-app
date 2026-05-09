# brain-app

**Product:** **Braintunnel** (this repository is the `brain-app` codebase). Hono + Svelte + ripmail — see [AGENTS.md](./AGENTS.md) for development setup and conventions.

## Local tooling (install once)

| Tool | Why |
|------|-----|
| **[nvm](https://github.com/nvm-sh/nvm)** + **Node from [.nvmrc](./.nvmrc)** | Required before any `npm` / `npx` / `node`. Wrong Node breaks native addons (`better-sqlite3`) and the desktop server-bundle (it copies the active `node` binary). From the repo root: `nvm use`. In scripts/agents: `source ~/.nvm/nvm.sh` then `nvm use`. |
| **Rust** (`rustup`, `cargo`, `rustc`) | Builds **[ripmail/](ripmail/)** and the Tauri **[desktop/](desktop/)** shell. On macOS you also need the **Xcode command-line tools** for linking and the desktop bundle. |
| **[cargo-nextest](https://nexte.st/)** (`cargo install cargo-nextest --locked`) | **Ripmail’s integration tests** (`ripmail/tests/suite`) **fail** if you run plain `cargo test -p ripmail` — the suite expects **nextest**. This repo aliases **`cargo t`** → `cargo nextest run` in [.cargo/config.toml](./.cargo/config.toml); **`npm run ripmail:test`** uses that alias. Library-only checks: `cargo test -p ripmail --lib` work without nextest. |

Then: copy [.env.example](./.env.example) → `.env`, **`nvm use`**, **`npm install`**, and **`npm run dev`**. Full workflow and CI parity: [AGENTS.md](./AGENTS.md).

## Docker and subprocess reaping

The production image sets **`tini` as `ENTRYPOINT`** (`Dockerfile`) so PID 1 reaps orphaned or short-lived child processes. For a one-off container without this image, `docker run --init` is an alternative.

The Node server additionally **waits every ripmail child to exit**, applies **timeouts**, **serialized + deduped refresh per `RIPMAIL_HOME`**, and forwards **`RIPMAIL_TIMEOUT`** to ripmail for wall-clock limits inside the CLI.
