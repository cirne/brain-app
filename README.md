# brain-app

**Product:** **Braintunnel** (this repository is the `brain-app` codebase). Hono + Svelte + in-process mail — see [AGENTS.md](./AGENTS.md) for development setup and conventions.

## Local tooling (install once)

| Tool | Why |
|------|-----|
| **[nvm](https://github.com/nvm-sh/nvm)** + **Node from [.nvmrc](./.nvmrc)** | Required before any **`pnpm`** / **`npx`** / **`node`** (this repo pins **pnpm** via **`packageManager`** + Corepack; do not use **`npm install`** / **`npm ci`** at root). Wrong Node breaks native addons (e.g. `better-sqlite3`). From the repo root: **`nvm use`**. |
| **Rust** (`rustup`, `cargo`, `rustc`) | Only if you work on the optional packaged app: Tauri shell under **`desktop/`**. Needs **Xcode command-line tools** on macOS for native linking. Guide: **[docs/architecture/desktop-tauri-experimental.md](./docs/architecture/desktop-tauri-experimental.md)**. |

Then: copy [.env.example](./.env.example) → `.env`, **`nvm use`**, **`corepack enable`**, **`pnpm install`**, and **`pnpm run dev`**. Workflow and tooling: **[AGENTS.md](./AGENTS.md)**.

## Docker and subprocess reaping

The production image sets **`tini` as `ENTRYPOINT`** (`Dockerfile`) so PID 1 reaps orphaned or short-lived child processes. For a one-off container without this image, `docker run --init` is an alternative.

The Node server additionally **waits every ripmail child to exit**, applies **timeouts**, **serialized + deduped refresh per `RIPMAIL_HOME`**, and forwards **`RIPMAIL_TIMEOUT`** to ripmail for wall-clock limits inside the CLI.
