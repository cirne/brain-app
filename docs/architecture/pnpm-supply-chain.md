# pnpm supply chain and notable dependencies

Brain-app resolves JavaScript packages with **[pnpm](https://pnpm.io/)** (`pnpm-lock.yaml` at the repo root, **`packageManager`** in `package.json` for Corepack). CI, local dev, and the **`Dockerfile`** use **`pnpm install --frozen-lockfile`** so installs match the committed lockfile.

## Why pnpm here

We moved from **npm** to **pnpm** to tighten reproducibility (content-addressable store, strict `node_modules` layout), improve install performance, and reduce accidental “works on my machine” drift. **Agents and contributors should use only `pnpm` in this repo** (see [AGENTS.md](../../AGENTS.md)); do not run **`npm install`** or **`npm ci`** at the root for normal workflow.

### `npm` → `pnpm` alias?

**No supported place in `package.json` wires a shell alias** (e.g. `alias npm=pnpm`). Enforcement is convention plus docs: **`npm`** is still the globally installed CLI with different behavior. If your muscle memory slips, **`corepack`** + **`packageManager`** will at least steer editors and some tooling toward the pinned **`pnpm`** version (`corepack prepare pnpm@…` matches `package.json`). For automation, scripts in `package.json` call **`pnpm run …`** where they nest other npm scripts (`build`, `ci`).

## `xlsx` (registry tarball only)

**SheetJS** stopped publishing **`xlsx` > 0.18.x** to the npm registry; newer builds were historically distributed via their CDN tarball. Brain needs only **`read` → CSV** for ripmail attachments, so we depend on **`xlsx@^0.18.5`** from the registry.

**`@earendil-works/pi-web-ui`** declares a CDN **`xlsx`** tarball in its own `package.json`; **`pnpm.overrides.xlsx`** in our root **`package.json`** forces **`0.18.5`** from the npm registry so the lockfile never depends on **`cdn.sheetjs.com`** for installs.

## Pi stack (**`@earendil-works/*`**)

Pi agent packages moved from **`@mariozechner/*`** to **`@earendil-works/*`** (same upstream line under a new npm scope). In this repo, bump **`pi-agent-core`**, **`pi-ai`**, **`pi-coding-agent`**, and **`pi-web-ui` together** on the **same semver line** (**`^0.74.0`** or whatever is current)—they interoperate via shared internal APIs.

**`pi-web-ui`** is vendored mainly for dependency alignment even though Brain’s Svelte UI does not import it directly today.

Docs that reference **`node_modules/.../README.md`** for Pi should use the **`@earendil-works`** paths after install.

## Lucide icons (**`@lucide/svelte`**)

**`lucide-svelte`** is deprecated; we use **`@lucide/svelte`** for Svelte 5-compatible icon components (`import { … } from '@lucide/svelte'`).

## Updating the lockfile

From the repo root, after **`nvm use`** (see [.nvmrc](../../.nvmrc)):

```sh
pnpm install            # adds/updates deps; refreshes pnpm-lock.yaml
pnpm install --frozen-lockfile   # CI / Docker — fail if lock out of sync
```

When changing dependencies, commit **`pnpm-lock.yaml`** with **`package.json`**.
