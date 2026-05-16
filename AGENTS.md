# brain-app (Braintunnel)

Hono + Svelte + pi-agent-core: Chat (agentic), Wiki browser, and Inbox (mail indexing in-process via `src/server/ripmail/`). **Product name:** **Braintunnel**. The repository and many env vars remain `brain-app` / `BRAIN_*` for historical reasons.

> **Cursor Cloud:** Quick setup (fnm, frozen install) — **[CLOUD-AGENTS.md](./CLOUD-AGENTS.md)**.

## Development rules

### Early development (no backward compatibility)

Early development, near-zero user base: optimize for velocity and simplicity, not preserving old state.

- **No backward compatibility by default** for local data, APIs, or on-disk formats unless [docs/PRODUCTIZATION.md](docs/PRODUCTIZATION.md) (or an explicit product decision) says otherwise.
- **No data migrations.** When SQLite schema, config, cache layout, or persisted formats change, **reset / delete local data / start fresh** as needed. Document breaking changes in commits or PRs.
- **Avoid compatibility complexity:** prefer a clean break and re-seeding over version flags or defensive readers for superseded formats.
- **Agent diagnostics** (`$BRAIN_HOME/var/agent-diagnostics/`): dev-only JSONL/JSON. **Never** migrate old log files or add code that reads legacy on-disk shapes. Bump `AGENT_DIAGNOSTICS_SCHEMA_VERSION` in `agentDiagnostics.ts` as needed; delete stale files locally if confusing.
- **Bug fixes / regressions: TDD.** Failing test first (or new test locking behavior), then fix; coverage in `src/**/*.test.ts` and component tests for UI bugs.
- **New substantial features:** defer automated tests until the feature stabilizes; validate with the user. **After** sign-off, add tests **before** landing.
- **Component tests:** Vitest (jsdom) + `@testing-library/svelte` — [docs/component-testing.md](docs/component-testing.md).
- **Lint / CI:** `pnpm run lint`; full gate: `pnpm run ci` (lint, typecheck, tests). ESLint fix: `pnpm exec eslint src/ --fix`.
- **Validate fixes yourself** when verification is obvious (lint, scoped tests, `pnpm run build` when relevant). Only defer if secrets are missing or the step would be destructive without confirmation.
- **DRY;** shared fixtures: `src/server/test-fixtures.ts`. Reuse test patterns; avoid one-off temp dirs per test.
- **UI:** Svelte 5 only — no React, no Next.js.

### Agent behavior (clarity and minimal diffs)

From [Karpathy-inspired agent principles](https://github.com/forrestchang/andrej-karpathy-skills) — use judgment; trivial fixes need no extra ceremony.

- **Think before coding.** Surface assumptions and tradeoffs; ask instead of guessing.
- **Simplicity first.** Minimum code for the problem; no speculative features or abstraction.
- **Surgical changes.** Match local style; note unrelated cleanup instead of doing it.
- **Goal-driven execution.** Define success for non-trivial work. TDD for bugs; user sign-off then tests for new features before calling done.
- **DRY with restraint.** Extract when repeated or clearly reusable; don't abstract one-offs.
- **Velocity ≠ guessing.** Small PRs, low ceremony; widen scope only when invoked.

### Design system

[DESIGN.md](DESIGN.md): tokens, typography, spacing. Align with `src/client/style.css` and Tailwind v4 `@theme`. Run `pnpm run design:lint` when changing DESIGN.md.

**Scope:** Repository stack, workflow, and conventions — not the LLM tool catalog; runtime agent behavior lives under `src/server/agent/` (code and tests).

Product ideas: `/Users/cirne/brain/wiki/ideas/brain-in-the-cloud.md`.

## Node.js and pnpm

Pin: [.nvmrc](.nvmrc) + `packageManager` in `package.json` (Corepack). **Use [pnpm](https://pnpm.io/) only** at repo root for installs and scripts — lockfile is `pnpm-lock.yaml` (not `package-lock.json`). **`nvm use`** before any Node command locally. Non-interactive shells: `source ~/.nvm/nvm.sh`, then `nvm use`, `corepack enable`, `pnpm install`.

Wrong Node version breaks native addons (e.g. `better-sqlite3` during `pnpm install`). Rationale and supply chain: [docs/architecture/pnpm-supply-chain.md](docs/architecture/pnpm-supply-chain.md).

## Dev

```sh
nvm use
corepack enable
pnpm install
pnpm run dev           # BRAIN_DATA_ROOT=./data; Hono + Vite on one port (see docs/google-oauth.md)
pnpm run dev:clean     # delete ./data (all tenants + .global/) — full wipe
```

Vite runs as middleware inside Hono. Durable dev state lives under **`./data`** (`BRAIN_DATA_ROOT`); tenants as `usr_…`; shared files under **`./data/.global/`**. **`pnpm run dev:clean`** removes the entire tree. In-app "delete all my data" removes only the **current** signed-in tenant. Sign-in, OAuth, and routing: [docs/architecture/runtime-and-routes.md](docs/architecture/runtime-and-routes.md).

## Configuration

Copy [.env.example](.env.example) → `.env`. Semantics: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/architecture/configuration.md](docs/architecture/configuration.md). **Full env inventory and contributor rule (do not add env vars without explicit user request):** [docs/architecture/environment-variables.md](docs/architecture/environment-variables.md).

Optional **`DO_TOKEN`** in `.env` is for local `doctl` only — Brain does not consume it. See [docs/digitalocean.md](docs/digitalocean.md).

## When you need more depth

- **System map, data plane, ADRs:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/architecture/README.md](docs/architecture/README.md)
- **Env:** [.env.example](.env.example), [docs/architecture/environment-variables.md](docs/architecture/environment-variables.md), [docs/architecture/configuration.md](docs/architecture/configuration.md)
- **UI tokens / icons:** [DESIGN.md](DESIGN.md); `pnpm run design:lint`
- **pnpm / Pi stack / lockfile:** [docs/architecture/pnpm-supply-chain.md](docs/architecture/pnpm-supply-chain.md)
- **Strategy / vision / Karpathy wiki post:** [docs/STRATEGY.md](docs/STRATEGY.md), [docs/VISION.md](docs/VISION.md), [docs/karpathy-llm-wiki-post.md](docs/karpathy-llm-wiki-post.md)
- **Onboarding + mail phases:** [docs/architecture/onboarding-state-machine.md](docs/architecture/onboarding-state-machine.md)
- **Mail (Rust era) archaeology:** [docs/architecture/ripmail-rust-snapshot.md](docs/architecture/ripmail-rust-snapshot.md)
- **Ops / observability:** [docs/digitalocean.md](docs/digitalocean.md), [docs/newrelic.md](docs/newrelic.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Backlog:** [docs/BUGS.md](docs/BUGS.md), [docs/IDEAS.md](docs/IDEAS.md), [docs/OPPORTUNITIES.md](docs/OPPORTUNITIES.md), [docs/PRODUCTIZATION.md](docs/PRODUCTIZATION.md)
- **Malware lockfile check:** [docs/npm-known-malware.md](docs/npm-known-malware.md) (`pnpm run check:malware-lockfile`, part of `pnpm run ci`)
- **External platforms outside built-in tooling:** `~/.codex/skills/one/SKILL.md` (`one` CLI)
