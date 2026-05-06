# Cloud Agent Setup (Cursor Cloud)

Quick setup for cloud agents working on the **web app** (Hono + Svelte). Email/inbox features require ripmail—either download the pre-built binary or skip for web-only development.

## Required Secrets

Ensure you have environment variables before setup. If they are not present, exit early.

| Secret | Purpose | Required |
|--------|---------|----------|
| `GITHUB_TOKEN` | Download ripmail from private releases | For email features |
| `ANTHROPIC_API_KEY` | Claude LLM (default provider) | Yes (or use OpenAI) |
| `OPENAI_API_KEY` | OpenAI LLM (alternative) | Yes (or use Anthropic) |

## Setup (30 seconds)

Cursor Cloud images may not have `nvm` installed even though the main developer guide uses `nvm use`. In cloud agents, prefer `fnm` and verify the active Node matches `.nvmrc` before running `npm`, `npx`, or `node`.

```sh
# Install Node 24 (matches .nvmrc) and dependencies
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc  # or restart shell
fnm install "$(cat .nvmrc)"
fnm use "$(cat .nvmrc)"
node --version
npm install
```

If `node` / `npm` still point at the wrong version in a non-interactive shell, initialize `fnm` in that shell before running commands:

```sh
eval "$(fnm env --use-on-cd --shell bash)"
fnm use "$(cat .nvmrc)"
```

## Optional: Download ripmail binary

CI publishes a pre-built Linux x86_64 binary to GitHub Releases on each push to main. For private repos, use authenticated download:

```sh
# Download from private release (requires GITHUB_TOKEN)
curl -fsSL \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/octet-stream" \
  "https://api.github.com/repos/cirne/brain-app/releases/tags/ripmail-latest" \
  | jq -r '.assets[] | select(.name == "ripmail-linux-x86_64") | .url' \
  | xargs -I {} curl -fsSL -H "Authorization: token $GITHUB_TOKEN" -H "Accept: application/octet-stream" {} -o ripmail

chmod +x ripmail
export RIPMAIL_BIN="$(pwd)/ripmail"
```

Or simpler with `gh` CLI (if available):

```sh
gh release download ripmail-latest --pattern 'ripmail-linux-x86_64' --output ripmail
chmod +x ripmail
export RIPMAIL_BIN="$(pwd)/ripmail"
```

Verify it works:

```sh
./ripmail --version
```

With `RIPMAIL_BIN` set, `npm run dev` will use this binary for inbox/email features.

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

Without ripmail, the server starts but inbox/email features return errors—this is fine for web-only development.

## What NOT to do

- **Do NOT assume `nvm` exists** in Cursor Cloud. `AGENTS.md` remains correct for local/dev machines with `nvm`, but cloud images commonly use the `fnm` setup above; verify with `node --version` before running Node commands.
- **Do NOT run `cargo build`** or any Rust commands—cloud agents don't have Rust toolchain
- **Do NOT run `npm run ripmail:*`** commands—they require Rust
- **Do NOT run `npm run desktop:*`** commands—they require macOS + Rust
- **Do NOT run `npm run ci`** (full CI includes Rust checks)—use `npm run lint && npm run typecheck && npm run test` instead

## Cloud-safe commands

| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Run tests | `npm test` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Build (web only) | `npm run build` |
| Kill dev server | `npm run dev:kill` |

## Hosted / multi-tenant: Enron demo (staging parity)

Cloud agents usually run **single-tenant** `npm run dev` without `BRAIN_DATA_ROOT`. To exercise **hosted** flows (inbox + wiki against a fixed Enron-backed tenant), use the same stack as Docker/staging: set `BRAIN_DATA_ROOT`, `BRAIN_ENRON_DEMO_SECRET` (any non-empty value), and optionally pre-seed with `EVAL_ENRON_TAR` + `npm run brain:seed-enron-demo`. Full operator guide: **[docs/architecture/enron-demo-tenant.md](./docs/architecture/enron-demo-tenant.md)**.

## Full documentation

For the complete development guide (including native macOS app, ripmail, and Rust), see **[AGENTS.md](./AGENTS.md)**. **Onboarding states and first-time mail sync:** [docs/architecture/onboarding-state-machine.md](./docs/architecture/onboarding-state-machine.md).
