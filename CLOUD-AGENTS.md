# Cloud Agent Setup (Cursor Cloud)

Quick setup for cloud agents working on the **web app** (Hono + Svelte). Mail/inbox runs **in-process** in Node (`src/server/ripmail/`); no Rust ripmail binary is required.

## Required Secrets

Ensure you have environment variables before setup. If they are not present, exit early.

| Secret | Purpose | Required |
|--------|---------|----------|
| `ANTHROPIC_API_KEY` | Claude LLM (default provider) | Yes (or use OpenAI) |
| `OPENAI_API_KEY` | OpenAI LLM (alternative) | Yes (or use Anthropic) |

## Setup (30 seconds)

This repo now defines a cloud-agent environment at [`.cursor/environment.json`](./.cursor/environment.json). On agent boot, Cursor runs:

```sh
bash ./scripts/cloud-agent/setup-node.sh && npm install
```

That setup script:

- installs `fnm` if missing
- installs and selects the Node version pinned in [`.nvmrc`](./.nvmrc) (Node 24)
- configures shell startup so future terminals pick up the same Node version

After startup, verify once:

```sh
node --version
npm --version
```

If you are on an older cloud environment that does not yet apply `.cursor/environment.json`, run this once manually:

```sh
bash ./scripts/cloud-agent/setup-node.sh
npm install
```

## Configuration

Create `.env` from the example and add your API keys:

```sh
cp .env.example .env
# Edit .env to add ANTHROPIC_API_KEY or OPENAI_API_KEY
```

## Run

```sh
npm run dev      # Hono + Vite on :3000
```

## What NOT to do

- **Do NOT assume `nvm` exists** in Cursor Cloud. `AGENTS.md` remains correct for local/dev machines with `nvm`, but cloud images commonly use the `fnm` setup above; verify with `node --version` before running Node commands.
- **Do NOT run `cargo build`** or any Rust commands unless you explicitly need the Tauri desktop crate (`desktop/`).
- **Do NOT run `npm run desktop:*`** commands—they require macOS + Xcode/Rust for native builds.

## Cloud-safe commands

| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Run tests | `npm test` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Kill dev server | `npm run dev:kill` |

## Hosted / multi-tenant: Enron demo (staging parity)

Cloud agents usually run **single-tenant** `npm run dev` without `BRAIN_DATA_ROOT`. To exercise **hosted** flows (inbox + wiki against Enron-backed tenants), use the same stack as Docker/staging: set `BRAIN_DATA_ROOT`, `BRAIN_ENRON_DEMO_SECRET` (any non-empty value), and optionally pre-seed with `EVAL_ENRON_TAR` + **`npm run brain:seed-enron-demo`** (or one mailbox via `BRAIN_ENRON_DEMO_USER` + `scripts/brain/seed-enron-demo-tenant.mjs`). Full operator guide: **[docs/architecture/enron-demo-tenant.md](./docs/architecture/enron-demo-tenant.md)**.

## Full documentation

For the complete development guide (including native macOS app and Rust desktop shell), see **[AGENTS.md](./AGENTS.md)**. **Onboarding states and first-time mail sync:** [docs/architecture/onboarding-state-machine.md](./docs/architecture/onboarding-state-machine.md).
