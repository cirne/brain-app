---
version: alpha
name: Braintunnel
description: A local-first console for chat, wiki, inbox, and agents—“ink & ember”: warm stationery, not neon terminal cosplay nor generic SaaS chrome.
colors:
  primary: "#95664d"
  on-primary: "#fcfaf8"
  surface: "#f4f1eb"
  surface-1: "#f4f1eb"
  surface-2: "#eae6de"
  surface-3: "#dfd9cf"
  border: "#c4bcb0"
  foreground: "#1b1917"
  muted: "#5e5a53"
  accent-dim: "#ece4dd"
  danger: "#b91c1c"
  on-danger: "#fef2f2"
  success: "#0f6b41"
  on-success: "#f6faf7"
typography:
  display:
    fontFamily: '"IBM Plex Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 2.125rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  heading:
    fontFamily: '"IBM Plex Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"IBM Plex Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"IBM Plex Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: 0.8125rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
rounded:
  sm: 8px
  md: 12px
  lg: 16px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  app-canvas:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  side-rail:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  workspace-panel:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
  nested-well:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px
  divider:
    backgroundColor: "{colors.border}"
    textColor: "{colors.foreground}"
    size: 1px
  primary-action:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 10px
  quiet-action:
    backgroundColor: "{colors.accent-dim}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 10px
  destructive-action:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 10px
  positive-status:
    backgroundColor: "{colors.success}"
    textColor: "{colors.on-success}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 8px
---

## Overview

Braintunnel should read as **a warm personal workstation**: **light mode** is **ledger paper** (cream stone surfaces, muted warm borders, deep ink-brown type) with a single **ember / terracotta** accent—not minty SaaS teal, not sterile gray dashboards. **Dark mode** stays **brown-charcoal**, not OLED black with neon green glow: **parchment body text** plus the same amber family for interactions so long sessions stay legible.

The identity is **one accent hue** across surfaces (ember), **muted warm neutrals** for structure, **IBM Plex Sans** for default UI readability, **Plex Mono** only where monospace helps (handles, IDs, code). Reds and greens remain **semantic** (danger / success); they must not hijack routine chrome.

## Light mode (“the construct”)

Yes—the app ships **light as default** in CSS (`:root`), then follows **`prefers-color-scheme: dark`** for the charcoal palette. The light program reads as **stationery**: pale warm gray-beige surfaces, stone-tinted borders, **ink-brown** primary type, **terracotta** for links and filled actions—not green-washed backgrounds.

## Colors

The runtime source of truth remains `src/client/style.css`. This file documents the intended values and should be kept aligned with the `:root` variables and Tailwind v4 `@theme` aliases.

**Tailwind v4 — custom spacing:** The YAML `spacing` block (xs … xl) is design intent, not something to mirror as `--spacing-xs`, `--spacing-lg`, etc. inside `@theme`. Those names **override Tailwind’s spacing scale** and collide with other utilities that reuse the same keys (for example `max-w-lg` may compile to a tiny pixel width instead of `32rem`). Keep spec spacing in **prefixed `:root` variables** (e.g. `--bt-space-lg`) and use them in component CSS or arbitrary values; reserve `@theme` for colors, radii, fonts, and other tokens that do not hijack Tailwind’s built‑in scales.

- `rounded.sm` / `md` / `lg` map to `--radius-sm` / `--radius-md` / `--radius-lg` in **`@theme`** in `src/client/style.css` (Tailwind surfaces them on the root for utilities and plain `var(--radius-*)` use). Tailwind utilities (`rounded-sm`, etc.) compile to `border-radius: var(--radius-*)`.
- `surface`, `surface-1`, `surface-2`, and `surface-3` map to the Tailwind utilities `bg-surface`, `bg-surface-1`, `bg-surface-2`, and `bg-surface-3`.
- `surface-selected`: mix of **accent** into **`--bg-2`** (`--surface-selected` in CSS) → `bg-surface-selected`. Use on **lists whose parent rail is `surface-2`** (e.g. active chat row) where `accent-dim` would disappear into the rail. Keep `accent-dim` for mentions, dropdown hovers, and other soft washes off the rail.
- `foreground`, `muted`, `border`, `primary`, `accent-dim`, `danger`, and `success` map to the existing text, border, and status utilities.
- `on-primary` maps to `text-accent-foreground` and should be used for text or icons inside filled accent controls.
- `primary` is the main interaction color (muted ember / russet terracotta). Use it for links, primary buttons, selection, and progress—not a second saturated brand hue.
- `accent-dim` is a soft wash for hover/selected quiet controls; don’t rely on it alone when contrast or focus must be obvious.

**Dark mode** (system preference): warm low luminance—not pure black, not green-shifted shadow:

- `surface`: `#131110`
- `surface-2`: `#1c1a17`
- `surface-3`: `#262320`
- `border`: `#3d3935`
- `foreground`: `#f0eae2`
- `muted`: `#a89f93`
- `primary`: `#c9935c`
- `on-primary`: `#171210`
- `accent-dim`: `#2a221a`
- `danger`: `#f87171` (lighter for readable error text)
- `success`: `#34d399`

Accent chroma stays **warm amber** so dark mode stays cozy; avoid hypersaturated oranges that read as alarms for non-error UI.

## Typography

**IBM Plex** is a type *family*, not one font: **IBM Plex Sans** drives default UI copy (`font-family` on `:root`); **IBM Plex Mono** is for **identifiers, tooling rows, excerpts, code** wherever components opt in (`font-mono` or `[font-family:var(--font-mono)]`).

Google Fonts loads **Plex Sans + Plex Mono** in `src/client/style.css`. `--font-sans` is the readable default stack; `--font-mono` is the technical rhythm stack.

`--font-sans` and `--font-mono` on `:root` are the implementation hooks; prefer `font-family: inherit` on form controls so they match the page.

## Layout

Pane-based: rail, transcript, wiki, inbox, slide-overs. Prefer **visible borders** over heavy shadows; the layout read is **tight stationery grid**, not stacked floaty cards or neon edge glow. Keep app layout variables in `src/client/style.css` (`--tab-h`, `--pane-header-px`, `--sidebar-w`, `--chat-column-max`) as implementation tokens.

## Elevation & Depth

Layer **surface steps** and **1px borders**. Reserve stronger shadow for overlays and modals. In dark mode, borders lean **neutral-warm gray**—no intentional green fringe; avoid large blurred halos unless a specific component already uses them.

## Shapes

**Soft stationery radii** (`sm` / `md` / `lg` above): corners are clearly rounded for approachability—chips/small buttons use **`rounded-sm`**, panels and wells use **`rounded-md`/`rounded-lg`** as scale demands—not pill-everywhere. Reserve **`rounded-full`** for spinners, switch thumbs, and true circular affordances.

## Components

Primary actions: `primary` fill with `on-primary`. Prefer shared `.bt-btn` variants before one-off buttons. Secondary: `accent-dim` with `primary` text. Destructive and success use semantic reds/greens and should not steal the main accent for routine UI.

## Do's and Don'ts

- Do keep **one ember-accent story** across agent, wiki, and mail chrome (muted stone neutrals everywhere else).
- Do use semantic Tailwind utilities from `@theme` before raw hex.
- Do **not** define `--spacing-*` keys in `@theme` to match YAML spacing; use prefixed `:root` spacing variables (see **Tailwind v4 — custom spacing** above).
- Do treat **dark mode as first-class** (system); light is the default ledger, not an afterthought.
- Do not paste raw SVG icons; import **`@lucide/svelte`** and register tool-side icons in [`src/client/lib/tools/registryIcons.ts`](src/client/lib/tools/registryIcons.ts) (`getToolIcon` / `toolIcons.js`); generic fallback (e.g. `Wrench` in `ToolCallBlock`) for unregistered tool names.
- For **icon + label in one row**, use `inline-flex` (or `flex`) with **`items-center`**, stable **`line-height`** on the label if needed, and expect occasional **0–1px** optical nudge on the icon wrapper at small sizes; avoid `items-start` for icon+title chips unless intentional.
- Do not add extra brand colors for ordinary states.
- Do not replace `src/client/style.css` with generated output unless the export workflow is explicitly adopted.
