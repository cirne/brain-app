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
bash ./scripts/cloud-agent/setup-node.sh && corepack enable && pnpm install --frozen-lockfile
```

That setup script:

- installs `fnm` if missing
- installs and selects the Node version pinned in [`.nvmrc`](./.nvmrc) (Node 24)
- configures shell startup so future terminals pick up the same Node version

After startup, verify once:

```sh
node --version
pnpm --version
```

If you are on an older cloud environment that does not yet apply `.cursor/environment.json`, run this once manually:

```sh
bash ./scripts/cloud-agent/setup-node.sh
corepack enable
pnpm install
```

## Historical: Rust `ripmail` Linux binary (pre–TypeScript `main`)

On **`main` before the OPP-103 cutover**, CI published `ripmail-linux-x86_64` under rolling release tag **`ripmail-latest`**. This branch runs mail **in-process** in Node—**no** separate binary or `RIPMAIL_BIN` download. For git tags that pin the last Rust tree and for the **CI/release teardown checklist** after merge, see **[docs/architecture/ripmail-rust-snapshot.md](docs/architecture/ripmail-rust-snapshot.md)**.

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
- **Do NOT run `cargo build`** or any Rust commands unless you are doing **experimental** work on the packaged macOS app — see **[docs/architecture/desktop-tauri-experimental.md](./docs/architecture/desktop-tauri-experimental.md)**.
- **Do NOT run `npm run desktop:*`** — they require macOS + Xcode/Rust; same doc for when that is intentional.

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

For **web** repo conventions and agent-behavior rules, see **[AGENTS.md](./AGENTS.md)** (it applies in cloud too). **Packaged macOS app (experimental):** [docs/architecture/desktop-tauri-experimental.md](./docs/architecture/desktop-tauri-experimental.md). **Onboarding states and first-time mail sync:** [docs/architecture/onboarding-state-machine.md](./docs/architecture/onboarding-state-machine.md).
